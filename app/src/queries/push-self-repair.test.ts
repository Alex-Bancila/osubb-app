import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

const MEMBER = vi.hoisted(() => '22222222-2222-4222-8222-222222222222');
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));

import { pushOnHere, unsubscribeDevice } from '../lib/push-device';
import { bytesToUrlBase64, urlBase64ToUint8Array } from '../lib/vapid-key';
import { PUSH_SUBSCRIPTION_CHANGED } from '../pwa/push-renewal';
import {
  resetPushSelfRepairForTests,
  usePushSelfRepair,
} from './push-subscription';

/* Two synthetic keys in a P-256 public key's shape (65 bytes, 0x04 first),
   built here so they are plainly not real: the build's key now, and the one
   an earlier VAPID pair used. */
function syntheticKey(seed: number) {
  return Uint8Array.from([
    0x04,
    ...Array.from({ length: 64 }, (_, index) => (index * 31 + seed) % 256),
  ]);
}
const NEW_KEY = bytesToUrlBase64(syntheticKey(7));
const OLD_KEY = bytesToUrlBase64(syntheticKey(200));

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: ReturnType<typeof vi.fn>;
};

function fakeSubscription(endpoint: string, key: string | null) {
  const json: PushSubscriptionJSON = {
    endpoint,
    expirationTime: null,
    keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` },
  };
  const subscription: FakeSubscription = {
    endpoint,
    options: {
      applicationServerKey: key
        ? (urlBase64ToUint8Array(key).buffer as ArrayBuffer)
        : null,
    },
    toJSON: () => json,
    unsubscribe: vi.fn(async () => {
      if (browser.current === subscription) browser.current = null;
      return true;
    }),
  };
  return subscription;
}
const tokenOf = (subscription: FakeSubscription) =>
  JSON.stringify(subscription.toJSON());

let browser: {
  current: FakeSubscription | null;
  fresh: FakeSubscription;
  subscribe: ReturnType<typeof vi.fn>;
  listeners: Set<(event: MessageEvent) => void>;
  permission: NotificationPermission;
};

function installBrowser() {
  const fresh = fakeSubscription('https://push.example.test/fresh', NEW_KEY);
  const subscribe = vi.fn(async () => {
    browser.current = fresh;
    return fresh;
  });
  const listeners = new Set<(event: MessageEvent) => void>();
  browser = {
    current: null,
    fresh,
    subscribe,
    listeners,
    permission: 'granted',
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => browser.current),
      subscribe,
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
      addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (event: MessageEvent) => void,
      ) => listeners.delete(listener),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    get permission() {
      return browser.permission;
    },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

/** The row lookup: select → eq → eq → maybeSingle. */
function rowPresent(...answers: boolean[]) {
  for (const present of answers)
    supabaseMock.maybeSingle.mockResolvedValueOnce({
      data: present ? { id: 'token-row' } : null,
      error: null,
    });
}

const markerKey = `osubb.push-on.${MEMBER}`;

describe('usePushSelfRepair (#769)', () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetPushSelfRepairForTests();
    localStorage.clear();
    installBrowser();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', NEW_KEY);
    supabaseMock.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resubscribes when the subscription was made with another VAPID key', async () => {
    const stale = fakeSubscription('https://push.example.test/old', OLD_KEY);
    browser.current = stale;
    rowPresent(true);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
    expect(supabaseMock.delete).toHaveBeenCalledTimes(1);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(stale));
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(NEW_KEY),
    });
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      member_id: MEMBER,
      token: tokenOf(browser.fresh),
      platform: 'web',
    });
    expect(pushOnHere(MEMBER)).toBe(true);
  });

  it('resubscribes when the row is missing and push is on here', async () => {
    const current = fakeSubscription('https://push.example.test/cur', NEW_KEY);
    browser.current = current;
    localStorage.setItem(markerKey, '1');
    rowPresent(false);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
    expect(current.unsubscribe).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    // No row to delete: it was already gone.
    expect(supabaseMock.delete).not.toHaveBeenCalled();
    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ token: tokenOf(browser.fresh) }),
    );
  });

  it('subscribes again when push is on here but the browser lost the subscription', async () => {
    localStorage.setItem(markerKey, '1');

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
  });

  it('leaves a subscription alone when its row is missing and push was never turned on here', async () => {
    // Another Member's leftover, or a switch turned off: never taken over.
    browser.current = fakeSubscription('https://push.example.test/x', OLD_KEY);
    rowPresent(false);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.maybeSingle).toHaveBeenCalled());
    await Promise.resolve();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(browser.current?.unsubscribe).not.toHaveBeenCalled();
  });

  it('does nothing to a healthy device, and remembers push is on here', async () => {
    const current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    browser.current = current;
    rowPresent(true);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(pushOnHere(MEMBER)).toBe(true));
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('never prompts: without a granted permission nothing is read or changed', async () => {
    browser.permission = 'default';
    localStorage.setItem(markerKey, '1');

    renderHook(() => usePushSelfRepair(), { wrapper });
    await Promise.resolve();
    await Promise.resolve();

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('runs once per page load, not on every mount', async () => {
    const current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    browser.current = current;
    rowPresent(true);

    const first = renderHook(() => usePushSelfRepair(), { wrapper });
    await waitFor(() =>
      expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1),
    );
    first.unmount();
    renderHook(() => usePushSelfRepair(), { wrapper });
    await Promise.resolve();

    expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('stores the subscription the worker renewed and drops the old row', async () => {
    const current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    browser.current = current;
    rowPresent(true);
    renderHook(() => usePushSelfRepair(), { wrapper });
    await waitFor(() => expect(pushOnHere(MEMBER)).toBe(true));

    rowPresent(true);
    const renewed = fakeSubscription('https://push.example.test/new', NEW_KEY);
    for (const listener of browser.listeners)
      listener(
        new MessageEvent('message', {
          data: {
            type: PUSH_SUBSCRIPTION_CHANGED,
            subscription: renewed.toJSON(),
            oldSubscription: current.toJSON(),
          },
        }),
      );

    await waitFor(() => expect(supabaseMock.delete).toHaveBeenCalledTimes(1));
    expect(supabaseMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ token: tokenOf(renewed) }),
    );
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(current));
  });

  it('turning the switch off forgets that push is on here', async () => {
    localStorage.setItem(markerKey, '1');
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);

    await unsubscribeDevice(MEMBER);

    expect(pushOnHere(MEMBER)).toBe(false);
  });
});
