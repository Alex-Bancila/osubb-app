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

import { pushTurnedOffHere, urlBase64ToUint8Array } from '../lib/push-device';
import { usePushSubscription } from './push-subscription';

// A synthetic key with a P-256 public key's shape — 65 bytes starting 0x04,
// base64url without padding — built here rather than pasted, so it is plainly
// not a real key. Bytes 248–255 make the encoding use both `-` and `_`.
const VAPID_BYTES = Uint8Array.from([
  0x04,
  ...Array.from({ length: 64 }, (_, index) => (index * 37 + 248) % 256),
]);
const VAPID_KEY = btoa(String.fromCharCode(...VAPID_BYTES))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.test/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};
const TOKEN = JSON.stringify(SUBSCRIPTION_JSON);
const PUSH_ON = 'osubb.push-on.' + MEMBER;

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
    localStorage.clear();
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

  it('replaces a subscription made with an earlier VAPID key, and its row', async () => {
    const staleJson = { ...SUBSCRIPTION_JSON, endpoint: 'https://old.test/x' };
    const stale: FakeSubscription = {
      toJSON: () => staleJson,
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

    // The stale row's delete → eq(member_id) → eq(token), the last awaited.
    supabaseMock.eq
      .mockReturnValueOnce(supabaseMock)
      .mockResolvedValueOnce({ error: null });
    rowPresent(true);
    act(() => result.current.enable());

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(supabaseMock.delete).toHaveBeenCalledTimes(1);
    expect(supabaseMock.eq).toHaveBeenCalledWith(
      'token',
      JSON.stringify(staleJson),
    );
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(2);
    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN }),
    );
  });

  it('keeps a working subscription when subscribing fails for another reason', async () => {
    browser.current = browser.subscription;
    browser.pushManager.subscribe.mockRejectedValueOnce(
      new DOMException('push service unreachable', 'AbortError'),
    );
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.enable());

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(browser.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(supabaseMock.delete).not.toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
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

  it.each([
    [
      'push_devices_limit',
      'Notificările sunt deja pornite pe 5 dispozitive, limita unui cont. Oprește-le pe un dispozitiv pe care nu îl mai folosești, apoi încearcă din nou.',
    ],
    [
      'push_endpoint_unsupported',
      'Browserul acesta folosește un serviciu de notificări pe care aplicația nu îl acceptă. Încearcă din Chrome, Firefox, Safari sau Edge.',
    ],
  ])(
    'says the %s refusal in Romanian (security pass M2)',
    async (reason, copy) => {
      supabaseMock.insert.mockResolvedValue({
        error: { code: '23514', message: reason },
      });
      const { result } = renderHook(() => usePushSubscription(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.enable());

      await waitFor(() => expect(result.current.error).toBe(copy));
      expect(result.current.subscribed).toBe(false);
    },
  );

  it('repairs before it reads off: push on here, permission granted, subscription dropped by the browser (2026-10-06)', async () => {
    // Production: a Chrome on Windows lost its subscription overnight and the
    // switch read off until a full reload. Now reading the switch repairs.
    localStorage.setItem(PUSH_ON, '1');
    browser.notification.permission = 'granted';
    supabaseMock.insert.mockResolvedValue({ error: null });
    rowPresent(true);

    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      member_id: MEMBER,
      token: TOKEN,
      platform: 'web',
    });
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('never repairs from the switch on a device where push was not turned on', async () => {
    browser.notification.permission = 'granted';
    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscribed).toBe(false);
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('says the browser took the permission back when push was on here', async () => {
    localStorage.setItem(PUSH_ON, '1');
    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.permission).toBe('default');
    expect(result.current.revoked).toBe(true);
    expect(result.current.subscribed).toBe(false);
    // It never prompts by itself.
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('is not revoked on a device where push was never on', async () => {
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.revoked).toBe(false);
  });

  it('reads the permission again when the app comes back', async () => {
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.permission).toBe('default');

    browser.notification.permission = 'denied';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.permission).toBe('denied');
  });

  it('reports the state a change is heading to while it runs', async () => {
    let finish: (value: FakeSubscription) => void = () => undefined;
    browser.pushManager.subscribe.mockImplementationOnce(
      () =>
        new Promise<FakeSubscription>((resolve) => {
          finish = (value) => {
            browser.current = value;
            resolve(value);
          };
        }),
    );
    supabaseMock.insert.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.target).toBeNull();

    act(() => result.current.enable());
    await waitFor(() => expect(result.current.target).toBe(true));
    expect(result.current.subscribed).toBe(false);

    rowPresent(true);
    act(() => finish(browser.subscription));
    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(result.current.target).toBeNull();
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
    expect(VAPID_KEY).toMatch(/-/);
    expect(VAPID_KEY).toMatch(/_/);
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(65);
    expect(Array.from(bytes)).toEqual(Array.from(VAPID_BYTES));
  });
});

/* 2026-10-06: Acasă's card shares this enable, and push now switches itself
   on where the permission is granted unless the Member turned it off here. */
describe('usePushSubscription and the Acasă card (2026-10-06)', () => {
  const PUSH_OFF = 'osubb.push-off.' + MEMBER;

  beforeEach(() => {
    resetSupabaseMock();
    localStorage.clear();
    installBrowser();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID_KEY);
    rowPresent(false);
    supabaseMock.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks for the permission in the tap’s own call stack, before anything is awaited', async () => {
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // No await between the tap and the question: Safari and Firefox only
    // prompt for a direct result of the gesture.
    rowPresent(true);
    act(() => {
      result.current.enable();
      expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
  });

  it('asks nothing in a build without the VAPID key, and says so', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    const { result } = renderHook(() => usePushSubscription(), { wrapper });

    act(() => result.current.enable());

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('turning the switch off records it, so push is not switched on by itself', async () => {
    browser.current = browser.subscription;
    rowPresent(true);
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    supabaseMock.eq
      .mockReturnValueOnce(supabaseMock)
      .mockResolvedValueOnce({ error: null });
    act(() => result.current.disable());

    await waitFor(() => expect(supabaseMock.delete).toHaveBeenCalled());
    expect(pushTurnedOffHere(MEMBER)).toBe(true);
  });

  it('turning it on again clears that record', async () => {
    localStorage.setItem(PUSH_OFF, '1');
    const { result } = renderHook(() => usePushSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rowPresent(true);
    act(() => result.current.enable());

    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
    expect(pushTurnedOffHere(MEMBER)).toBe(false);
  });
});
