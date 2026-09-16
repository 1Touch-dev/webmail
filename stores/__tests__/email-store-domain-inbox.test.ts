import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDomainInboxAccountClients, useEmailStore } from '../email-store';
import { useAccountStore } from '../account-store';
import { useAuthStore } from '../auth-store';
import type { Mailbox } from '@/lib/jmap/types';

const mailbox = (overrides: Partial<Mailbox>): Mailbox => ({
  id: 'inbox',
  originalId: undefined,
  name: 'Inbox',
  role: 'inbox',
  sortOrder: 0,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
  myRights: {
    mayReadItems: true,
    mayAddItems: false,
    mayRemoveItems: false,
    maySetSeen: true,
    maySetKeywords: false,
    mayCreateChild: false,
    mayRename: false,
    mayDelete: false,
    maySubmit: false,
  },
  isSubscribed: true,
  accountId: 'admin-acc',
  accountName: 'admin@example.com',
  isShared: false,
  ...overrides,
});

describe('Domain Inbox source builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEmailStore.setState({ accountMailboxes: {} });
    useAccountStore.setState({
      accounts: [{
        id: 'admin-local',
        label: 'admin@example.com',
        serverUrl: 'https://mail.example.com',
        username: 'admin@example.com',
        authMode: 'basic',
        cookieSlot: 0,
        rememberMe: true,
        displayName: 'Domain Manager',
        email: 'admin@example.com',
        avatarColor: '#123456',
        lastLoginAt: 1,
        isConnected: true,
        hasError: false,
        isDefault: true,
      }],
      activeAccountId: 'admin-local',
      defaultAccountId: 'admin-local',
    });
  });

  it('returns only shared mail accounts visible through the active manager login', async () => {
    const client = {
      getAccountId: () => 'admin-acc',
      getAllMailboxes: vi.fn(async () => [
        mailbox({ id: 'own-inbox', accountId: 'admin-acc', isShared: false }),
        mailbox({
          id: 'owner-1:inbox',
          originalId: 'inbox',
          accountId: 'owner-1',
          accountName: 'sales@example.com',
          isShared: true,
        }),
        mailbox({
          id: 'owner-2:inbox',
          originalId: 'inbox',
          accountId: 'owner-2',
          accountName: 'support@example.com',
          isShared: true,
        }),
      ]),
    };
    useAuthStore.setState({
      getAllConnectedClients: () => new Map([['admin-local', client as never]]),
    });

    const sources = await buildDomainInboxAccountClients();

    expect(sources.map((source) => source.accountId)).toEqual(['owner-1', 'owner-2']);
    expect(sources.every((source) => source.isShared)).toBe(true);
    expect(client.getAllMailboxes).toHaveBeenCalledTimes(1);
  });
});
