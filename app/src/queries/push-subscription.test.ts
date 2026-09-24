import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

const MEMBER = vi.hoisted(() => '11111111-1111-4111-8111-111111111111');
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));

import { urlBase64ToUint8Array } from '../lib/push-device';
import { usePushSubscription } from './push-subscription';

// A real P-256 public key shape: 65 bytes, base64url, no padding.
const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.test/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};
const TOKEN = JSON.stringify(SUBSCRIPTION_JSON);

type FakeSubscription = {
  toJSON: () => typeof SUBSCRIPTION_JSON;
  unsubscribe: ReturnType<typeof vi.fn>;
};

let browser: {
  subscription: FakeSubscription;
  current: FakeSubscription | null;
  pushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  notification: {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };
};

function installBrowser() {
  const subscription: FakeSubscription = {
    toJSON: () => SUBSCRIPTION_JSON,
    unsubscribe: vi.fn(async () => {
      browser.current = null;
      return true;
    }),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => browser.current),
    subscribe: vi.fn(async () => {
      browser.current = subscription;
      return subscription;
    }),
  };
  const notification = {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn(async () => {
      notification.permission = 'granted';
      return 'granted' as NotificationPermission;
    }),
  };
  browser = { subscription, current: null, pushManager, notification };

  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', notification);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

/** The row lookup behind `subscribed`: select → eq → eq → maybeSingle. */
function rowPresent(present: boolean) {
  supabaseMock.maybeSingle.mockResolvedValue({
    data: present ? { id: 'token-row' } : null,
    error: null,
  });
}

describe('usePushSubscription', () => {
  beforeEach(() => {
    resetSupabaseMock();
    installBrowser();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID_KEY);
    rowPresent(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reports an unsupported browser and reads nothing', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.unstubAllGlobals();

    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    expect(result.current.supported).toBe(false);
    expect(result.current.permission).toBe('unsupported');
    expect(result.current.subscribed).toBe(false);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('reports a denied permission', () => {
    browser.notification.permission = 'denied';
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    expect(result.current.supported).toBe(true);
    expect(result.current.permission).toBe('denied');
  });

  it('reports a build without the VAPID key', () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    expect(result.current.configured).toBe(false);
  });

  it('shows the true state on load: subscription and row both present', async () => {
    browser.current = browser.subscription;
    rowPresent(true);

    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(supabaseMock.from).toHaveBeenCalledWith('push_tokens');
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', MEMBER);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', TOKEN);
  });

  it('reads as off when the subscription exists but its row is gone', async () => {
    browser.current = browser.subscription;
    rowPresent(false);

    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscribed).toBe(false);
  });

  it('enable asks permission, subscribes with the VAPID key and inserts one web row', async () => {
    supabaseMock.insert.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rowPresent(true);
    act(() => result.current.enable());

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(browser.notification.requestPermission).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    });
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      member_id: MEMBER,
      token: TOKEN,
      platform: 'web',
    });
    expect(result.current.permission).toBe('granted');
    expect(result.current.error).toBeNull();
  });

  it('treats a duplicate row (23505) as subscribed', async () => {
    supabaseMock.insert.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value' },
    });
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rowPresent(true);
    act(() => result.current.enable());

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('subscribes nothing when the member blocks the permission prompt', async () => {
    browser.notification.requestPermission.mockResolvedValueOnce('denied');
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.enable());

    await waitFor(() => expect(result.current.permission).toBe('denied'));
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('replaces a subscription made with an earlier VAPID key', async () => {
    const stale: FakeSubscription = {
      toJSON: () => SUBSCRIPTION_JSON,
      unsubscribe: vi.fn(async () => {
        browser.current = null;
        return true;
      }),
    };
    browser.current = stale;
    browser.pushManager.subscribe.mockRejectedValueOnce(
      new DOMException('different key', 'InvalidStateError'),
    );
    supabaseMock.insert.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.enable());

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalled());
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(2);
  });

  it('turns a failed insert into Romanian copy', async () => {
    supabaseMock.insert.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security' },
    });
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.enable());

    await waitFor(() =>
      expect(result.current.error).toBe(
        'Nu am putut schimba notificările pe acest dispozitiv. Verifică internetul și încearcă din nou.',
      ),
    );
    expect(result.current.subscribed).toBe(false);
  });

  it('disable unsubscribes and deletes this device row', async () => {
    browser.current = browser.subscription;
    rowPresent(true);
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    // delete → eq(member_id) → eq(token), the last one awaited.
    supabaseMock.eq
      .mockReturnValueOnce(supabaseMock)
      .mockResolvedValueOnce({ error: null });
    rowPresent(false);
    act(() => result.current.disable());

    await waitFor(() => expect(result.current.subscribed).toBe(false));
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    expect(supabaseMock.delete).toHaveBeenCalledTimes(1);
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', MEMBER);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', TOKEN);
  });

  it('deletes the row even when the browser unsubscribe fails', async () => {
    browser.current = browser.subscription;
    browser.subscription.unsubscribe.mockRejectedValueOnce(new Error('gone'));
    rowPresent(true);
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    supabaseMock.eq
      .mockReturnValueOnce(supabaseMock)
      .mockResolvedValueOnce({ error: null });
    act(() => result.current.disable());

    await waitFor(() => expect(supabaseMock.delete).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url VAPID key to its 65 bytes', () => {
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });
});
