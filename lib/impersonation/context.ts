import { cookies } from 'next/headers';
import { decryptPayload, encryptPayload } from '@/lib/auth/crypto';
import { getCookieOptions } from '@/lib/oauth/cookie-config';

const IMPERSONATION_CONTEXT_COOKIE = 'bulwark_impersonation_ctx';

export interface ImpersonationContext {
  mailbox: string;
  mailboxId?: string;
  tenantId?: string;
  actorUserId?: string;
  grantJti: string;
  issuer: string;
  slot: number;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function cookieName(slot: number): string {
  return slot === 0 ? IMPERSONATION_CONTEXT_COOKIE : `${IMPERSONATION_CONTEXT_COOKIE}_${slot}`;
}

function isContext(value: unknown): value is ImpersonationContext {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.mailbox === 'string'
    && typeof row.grantJti === 'string'
    && typeof row.issuer === 'string'
    && typeof row.slot === 'number';
}

function cookieOptions() {
  const { maxAge: _maxAge, ...rest } = getCookieOptions();
  return rest;
}

export function readImpersonationContextFromStore(
  cookieStore: CookieStore,
  slot: number,
): ImpersonationContext | null {
  const token = cookieStore.get(cookieName(slot))?.value;
  if (!token) return null;
  const payload = decryptPayload(token);
  return isContext(payload) ? payload : null;
}

export function setImpersonationContextInStore(
  cookieStore: CookieStore,
  slot: number,
  context: ImpersonationContext,
): void {
  cookieStore.set(
    cookieName(slot),
    encryptPayload(context as unknown as Record<string, unknown>),
    cookieOptions(),
  );
}

export function clearImpersonationContextInStore(cookieStore: CookieStore, slot: number): void {
  cookieStore.delete(cookieName(slot));
}
