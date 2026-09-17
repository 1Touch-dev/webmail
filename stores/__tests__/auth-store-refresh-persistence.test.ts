import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
const replaceWindowLocation = vi.hoisted(() => vi.fn());
const fetchConfig = vi.hoisted(() => vi.fn(async () => ({ settingsSyncEnabled: false })));
const evictAccount = vi.hoisted(() => vi.fn());

class MockJMAPClient {
  static withBearer(serverUrl: string, token: string, username: string) {
    return new MockJMAPClient(serverUrl, username, token);
  }

  constructor(
    readonly serverUrl: string,
    readonly username: string,
    readonly secret: string,
  ) {}

  async connect() {}
  async getIdentities() { return []; }
  getAuthHeader() { return 'Basic mock'; }
  getRateLimitRemainingMs() { return 0; }
  onConnectionChange() {}
  onRateLimit() {}
  supportsContacts() { return false; }
  supportsPrincipals() { return false; }
  supportsVacationResponse() { return false; }
  supportsCalendars() { return false; }
  supportsSieve() { return false; }
}

vi.mock('@/lib/browser-navigation', () => ({
  apiFetch,
  replaceWindowLocation,
  getPathPrefix: () => '',
  getLocaleFromPath: () => 'en',
}));

vi.mock('@/hooks/use-config', () => ({ fetchConfig }));

vi.mock('@/lib/jmap/client', () => ({
  JMAPClient: MockJMAPClient,
  RateLimitError: class RateLimitError extends Error {},
}));

vi.mock('@/lib/account-state-manager', () => ({
  snapshotAccount: vi.fn(),
  restoreAccount: vi.fn(() => false),
  clearAllStores: vi.fn(),
  evictAccount,
  evictAll: vi.fn(),
}));

import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';

function okJson(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('auth-store refresh persistence for basic auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiFetch.mockReset();
    replaceWindowLocation.mockReset();
    fetchConfig.mockReset();
    fetchConfig.mockResolvedValue({ settingsSyncEnabled: false });
    evictAccount.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    window.history.pushState({}, '', '/en/login');

    useAccountStore.setState({
      accounts: [],
      activeAccountId: null,
      defaultAccountId: null,
    });

    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isRateLimited: false,
      rateLimitUntil: null,
      serverUrl: null,
      username: null,
      client: null,
      identities: [],
      primaryIdentity: null,
      authMode: 'basic',
      rememberMe: false,
      accessToken: null,
      tokenExpiresAt: null,
      connectionLost: false,
      activeAccountId: null,
      isDemoMode: false,
      connectedAccountsRevision: 0,
    });
  });

  it('writes a non-persistent session cookie during basic login when rememberMe is off', async () => {
    apiFetch.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input) === '/api/auth/session?slot=0' && init?.method === 'POST') {
        return okJson({ ok: true });
      }
      if (String(input) === '/api/auth/stalwart-context' && init?.method === 'POST') {
        return okJson({ ok: true });
      }
      throw new Error(`Unexpected apiFetch call: ${init?.method ?? 'GET'} ${String(input)}`);
    });

    const success = await useAuthStore.getState().login(
      'https://mail.example.com',
      'user@example.com',
      'pass123',
      undefined,
      false,
    );

    expect(success).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    const sessionWrite = apiFetch.mock.calls.find(
      ([input, init]) => String(input) === '/api/auth/session?slot=0' && init?.method === 'POST',
    );
    expect(sessionWrite).toBeTruthy();
    expect(JSON.parse((sessionWrite?.[1] as RequestInit).body as string)).toMatchObject({
      serverUrl: 'https://mail.example.com',
      username: 'user@example.com',
      password: 'pass123',
      slot: 0,
      persistent: false,
    });
  });

  it('restores a basic account on reload even when rememberMe is off', async () => {
    useAccountStore.setState({
      accounts: [{
        id: 'user@example.com@mail.example.com',
        label: 'user@example.com',
        serverUrl: 'https://mail.example.com',
        username: 'user@example.com',
        authMode: 'basic',
        cookieSlot: 0,
        rememberMe: false,
        displayName: 'user@example.com',
        email: 'user@example.com',
        avatarColor: '#000000',
        lastLoginAt: Date.now(),
        isConnected: false,
        hasError: false,
        isDefault: true,
      }],
      activeAccountId: 'user@example.com@mail.example.com',
      defaultAccountId: 'user@example.com@mail.example.com',
    });

    apiFetch.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input) === '/api/auth/session?slot=0' && init?.method === 'PUT') {
        return okJson({
          serverUrl: 'https://mail.example.com',
          username: 'user@example.com',
          password: 'pass123',
        });
      }
      if (String(input) === '/api/auth/stalwart-context' && init?.method === 'POST') {
        return okJson({ ok: true });
      }
      throw new Error(`Unexpected apiFetch call: ${init?.method ?? 'GET'} ${String(input)}`);
    });

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().username).toBe('user@example.com');
    expect(useAccountStore.getState().accounts).toHaveLength(1);
    expect(evictAccount).not.toHaveBeenCalled();
  });
});
