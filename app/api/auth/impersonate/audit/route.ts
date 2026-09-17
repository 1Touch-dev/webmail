import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { readImpersonationConfig } from '@/lib/impersonation/master-config';
import { readImpersonationContextFromStore } from '@/lib/impersonation/context';
import { signImpersonationJwt } from '@/lib/impersonation/jwt';

export const runtime = 'nodejs';

const AUDIT_TOKEN_LIFETIME_SEC = 60;
const ALLOWED_KINDS = new Set(['email_list', 'email_search', 'email_get', 'thread_get', 'blob_get']);

type AuditBody = {
  kind?: unknown;
  slot?: unknown;
  account_id?: unknown;
  mailbox_id?: unknown;
  mailbox_role?: unknown;
  email_id?: unknown;
  email_ids?: unknown;
  thread_id?: unknown;
  blob_id?: unknown;
  query_present?: unknown;
  position?: unknown;
  limit?: unknown;
  file_name?: unknown;
  content_type?: unknown;
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeBody(raw: AuditBody): Record<string, unknown> {
  const kind = normalizeText(raw.kind);
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    throw new Error('Invalid impersonation audit kind');
  }
  const body: Record<string, unknown> = { kind };
  if (typeof raw.slot === 'number' && Number.isInteger(raw.slot) && raw.slot >= 0) body.slot = raw.slot;
  if (typeof raw.position === 'number' && Number.isInteger(raw.position) && raw.position >= 0) body.position = raw.position;
  if (typeof raw.limit === 'number' && Number.isInteger(raw.limit) && raw.limit > 0) body.limit = raw.limit;
  if (typeof raw.query_present === 'boolean') body.query_present = raw.query_present;
  const accountId = normalizeText(raw.account_id);
  if (accountId) body.account_id = accountId;
  const mailboxId = normalizeText(raw.mailbox_id);
  if (mailboxId) body.mailbox_id = mailboxId;
  const mailboxRole = normalizeText(raw.mailbox_role);
  if (mailboxRole) body.mailbox_role = mailboxRole;
  const emailId = normalizeText(raw.email_id);
  if (emailId) body.email_id = emailId;
  if (Array.isArray(raw.email_ids)) {
    const ids = raw.email_ids
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));
    if (ids.length > 0) body.email_ids = ids;
  }
  const threadId = normalizeText(raw.thread_id);
  if (threadId) body.thread_id = threadId;
  const blobId = normalizeText(raw.blob_id);
  if (blobId) body.blob_id = blobId;
  const fileName = normalizeText(raw.file_name);
  if (fileName) body.file_name = fileName;
  const contentType = normalizeText(raw.content_type);
  if (contentType) body.content_type = contentType;
  return body;
}

export async function POST(request: NextRequest) {
  const config = readImpersonationConfig();
  if (!config) {
    return new NextResponse('Not found', { status: 404 });
  }
  const platformBaseUrl = (process.env.API_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!platformBaseUrl) {
    return NextResponse.json({ error: 'Platform API is not configured' }, { status: 500 });
  }

  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Missing impersonated session' }, { status: 401 });
  }
  const cookieStore = await cookies();
  const context = readImpersonationContextFromStore(cookieStore, creds.slot);
  if (!context) {
    return NextResponse.json({ error: 'Missing impersonation context' }, { status: 403 });
  }
  const expectedUsername = `${context.mailbox}%${config.masterUser}`.toLowerCase();
  if (creds.username.toLowerCase() !== expectedUsername) {
    return NextResponse.json({ error: 'Impersonation context mismatch' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = normalizeBody((await request.json()) as AuditBody);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid audit body' },
      { status: 400 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signImpersonationJwt(
    {
      iss: config.expectedIssuer,
      iat: now,
      exp: now + AUDIT_TOKEN_LIFETIME_SEC,
      jti: randomUUID(),
      mailbox: context.mailbox,
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      mailbox_id: context.mailboxId,
      slot: context.slot,
    },
    config.jwtSecret,
  );

  const response = await fetch(`${platformBaseUrl}/mailboxes/impersonation/audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: text || 'Impersonation audit failed' },
      { status: response.status >= 400 ? response.status : 503 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
