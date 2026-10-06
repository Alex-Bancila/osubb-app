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

import {
  autoEnableDevice,
  forgetPushOn,
  pushOnHere,
  pushResumesHere,
  pushTurnedOffHere,
  repairDevice,
  subscribeDevice,
  unsubscribeDevice,
} from '../lib/push-device';
import { bytesToUrlBase64, urlBase64ToUint8Array } from '../lib/vapid-key';
import { PUSH_SUBSCRIPTION_CHANGED } from '../pwa/push-renewal';
import {
  PUSH_REPAIR_INTERVAL_MS,
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

    await waitFor(() => expect(supabaseMock.delete).toHaveBeenCalledTimes(1));
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
    // The stale row goes only after the new one is stored.
    expect(supabaseMock.insert.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.delete.mock.invocationCallOrder[0] ?? 0,
    );
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

  it('keeps the old row when resubscribing fails, for the next start to retry', async () => {
    const stale = fakeSubscription('https://push.example.test/old', OLD_KEY);
    stale.unsubscribe.mockRejectedValueOnce(new Error('unsubscribe failed'));
    browser.current = stale;
    browser.subscribe.mockRejectedValueOnce(
      new DOMException('different key', 'InvalidStateError'),
    );
    rowPresent(true);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(browser.subscribe).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supabaseMock.delete).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('keeps the old row when storing the new one fails', async () => {
    browser.current = fakeSubscription(
      'https://push.example.test/old',
      OLD_KEY,
    );
    supabaseMock.insert.mockResolvedValueOnce({
      error: { code: '42501', message: 'row-level security' },
    });
    rowPresent(true);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supabaseMock.delete).not.toHaveBeenCalled();
  });

  it('at the five-device cap, frees the old row first and then stores the new one (security pass M2)', async () => {
    const stale = fakeSubscription('https://push.example.test/old', OLD_KEY);
    browser.current = stale;
    supabaseMock.insert
      .mockResolvedValueOnce({
        error: { code: '23514', message: 'push_devices_limit' },
      })
      .mockResolvedValueOnce({ error: null });
    rowPresent(true);

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(2));
    expect(supabaseMock.delete).toHaveBeenCalledTimes(1);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(stale));
    // Refused, then the old row goes, then the new one is stored.
    expect(supabaseMock.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      supabaseMock.insert.mock.invocationCallOrder[0] ?? 0,
    );
    expect(supabaseMock.delete.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.insert.mock.invocationCallOrder[1] ?? 0,
    );
    expect(supabaseMock.insert).toHaveBeenLastCalledWith({
      member_id: MEMBER,
      token: tokenOf(browser.fresh),
      platform: 'web',
    });
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
    await new Promise((resolve) => setTimeout(resolve, 0));

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

/* 2026-10-06, "push turns itself off": production showed a browser losing its
   subscription in the background, its old row filling the five-device cap so
   the repair was refused, and five tabs repairing at once into two rows. */
describe('push stays on (2026-10-06)', () => {
  const tokenKey = `osubb.push-token.${MEMBER}`;

  function installLocks() {
    let tail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, work: () => Promise<unknown>) => {
      const run = tail.then(() => work());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    });
    return request;
  }

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
    Reflect.deleteProperty(navigator, 'locks');
    Reflect.deleteProperty(document, 'visibilityState');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('replaces the row this browser stored last when the browser lost its subscription', async () => {
    const lost = fakeSubscription('https://push.example.test/lost', NEW_KEY);
    localStorage.setItem(markerKey, '1');
    localStorage.setItem(tokenKey, tokenOf(lost));

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.delete).toHaveBeenCalledTimes(1));
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      member_id: MEMBER,
      token: tokenOf(browser.fresh),
      platform: 'web',
    });
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(lost));
    // Stored first, then the old row goes.
    expect(supabaseMock.insert.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.delete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(localStorage.getItem(tokenKey)).toBe(tokenOf(browser.fresh));
  });

  it('at the five-device cap, frees the row this browser stored last and stores again', async () => {
    // Production 2026-10-05: five refused inserts (push_devices_limit) and the
    // switch stuck off, because nothing knew which row was this browser's.
    const lost = fakeSubscription('https://push.example.test/lost', NEW_KEY);
    localStorage.setItem(markerKey, '1');
    localStorage.setItem(tokenKey, tokenOf(lost));
    supabaseMock.insert
      .mockResolvedValueOnce({
        error: { code: '23514', message: 'push_devices_limit' },
      })
      .mockResolvedValueOnce({ error: null });

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(2));
    expect(supabaseMock.delete).toHaveBeenCalledTimes(1);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(lost));
    expect(supabaseMock.delete.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.insert.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it('remembers the token of a healthy device', async () => {
    const current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    browser.current = current;
    rowPresent(true);

    expect(await repairDevice(MEMBER, NEW_KEY)).toBe('healthy');
    expect(localStorage.getItem(tokenKey)).toBe(tokenOf(current));
  });

  it('repairs once when several tabs start together', async () => {
    installLocks();
    localStorage.setItem(markerKey, '1');
    // The second tab, behind the lock, finds the row the first one stored.
    rowPresent(true);

    const outcomes = await Promise.all([
      repairDevice(MEMBER, NEW_KEY),
      repairDevice(MEMBER, NEW_KEY),
    ]);

    expect(outcomes).toEqual(['repaired', 'healthy']);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
  });

  it('runs again when the app comes back after the interval, and not before', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    rowPresent(true, true);

    renderHook(() => usePushSelfRepair(), { wrapper });
    await waitFor(() =>
      expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1),
    );

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + PUSH_REPAIR_INTERVAL_MS + 1);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() =>
      expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(2),
    );
  });

  it('turning the switch off during a repair in another tab stays off', async () => {
    installLocks();
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    rowPresent(true);

    // The repair holds the lock and marks push on (its row exists); the
    // switch-off waits behind it.
    await Promise.all([
      repairDevice(MEMBER, NEW_KEY),
      unsubscribeDevice(MEMBER),
    ]);

    expect(pushOnHere(MEMBER)).toBe(false);
  });

  it('turning the switch off also deletes the row of a subscription this browser lost', async () => {
    const current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    browser.current = current;
    localStorage.setItem(markerKey, '1');
    localStorage.setItem(tokenKey, 'lost-subscription-json');

    await unsubscribeDevice(MEMBER);

    expect(supabaseMock.delete).toHaveBeenCalledTimes(2);
    expect(supabaseMock.eq).toHaveBeenCalledWith('token', tokenOf(current));
    expect(supabaseMock.eq).toHaveBeenCalledWith(
      'token',
      'lost-subscription-json',
    );
    expect(localStorage.getItem(tokenKey)).toBeNull();
  });
});

/* 2026-10-06, Alex: "is there any way in which i can set by default the
   notification as approved and on?" Push switches itself back on where it was
   on when this Member's session here ended -- never on absent history, which
   is also what a switch-off from before the off flag existed looks like. */
describe('push back on where it was on (2026-10-06)', () => {
  const offKey = `osubb.push-off.${MEMBER}`;
  const resumeKey = `osubb.push-resume.${MEMBER}`;

  function installLocks() {
    let tail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, work: () => Promise<unknown>) => {
      const run = tail.then(() => work());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    });
    return request;
  }

  /** Push was on here when this Member's last session ended. */
  function wasOnAtSignOut() {
    localStorage.setItem(resumeKey, '1');
  }

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
    Reflect.deleteProperty(navigator, 'locks');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('switches push back on at app start: on at the last sign-out, granted, nothing subscribed', async () => {
    wasOnAtSignOut();

    renderHook(() => usePushSelfRepair(), { wrapper });

    await waitFor(() => expect(supabaseMock.insert).toHaveBeenCalledTimes(1));
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
    // Resumed: nothing is left to resume.
    expect(pushResumesHere(MEMBER)).toBe(false);
  });

  it('a switch-off from before this release (no flags, granted, no subscription) stays off', async () => {
    // Production since 2026-10-02: the switch unsubscribed and cleared the
    // push-on flag, and nothing recorded the off.
    renderHook(() => usePushSelfRepair(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('a sign-out while push is on resumes it at the next sign-in here', async () => {
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    localStorage.setItem(markerKey, '1');
    // What signOut() runs: the row goes, the choice is not recorded.
    await unsubscribeDevice(MEMBER);
    expect(browser.current).toBeNull();
    expect(pushTurnedOffHere(MEMBER)).toBe(false);
    expect(pushResumesHere(MEMBER)).toBe(true);

    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('enabled');
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
  });

  it('a sign-out on a device subscribed before the push-on flag resumes it too, read from its row', async () => {
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    rowPresent(true);

    await unsubscribeDevice(MEMBER);

    expect(pushResumesHere(MEMBER)).toBe(true);
    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('enabled');
  });

  it('a sign-out while push is off leaves nothing to resume', async () => {
    rowPresent(false);

    await unsubscribeDevice(MEMBER);

    expect(pushResumesHere(MEMBER)).toBe(false);
    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('a sign-out with a subscription this Member has no row for leaves nothing to resume', async () => {
    browser.current = fakeSubscription('https://push.example.test/x', NEW_KEY);
    rowPresent(false);

    await unsubscribeDevice(MEMBER);

    expect(pushResumesHere(MEMBER)).toBe(false);
  });

  it('a session that expires while push is on resumes it at the next sign-in here', async () => {
    localStorage.setItem(markerKey, '1');

    // What auth.tsx runs when a session ends without the sign-out button.
    forgetPushOn(MEMBER);
    expect(pushOnHere(MEMBER)).toBe(false);
    expect(pushResumesHere(MEMBER)).toBe(true);

    // The browser dropped the subscription meanwhile.
    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('enabled');
  });

  it('a session that expires while push is off leaves nothing to resume', () => {
    forgetPushOn(MEMBER);
    expect(pushResumesHere(MEMBER)).toBe(false);
  });

  it('never after the Member turned it off with the switch, and the off drops the resume marker', async () => {
    wasOnAtSignOut();
    browser.current = fakeSubscription('https://push.example.test/ok', NEW_KEY);
    await unsubscribeDevice(MEMBER, { turnedOff: true });
    expect(pushTurnedOffHere(MEMBER)).toBe(true);
    expect(pushResumesHere(MEMBER)).toBe(false);

    renderHook(() => usePushSelfRepair(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it('never while the switch-off stands, even with a resume marker', async () => {
    wasOnAtSignOut();
    localStorage.setItem(offKey, '1');

    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('turning push on again lifts the switch-off and the resume marker', async () => {
    localStorage.setItem(offKey, '1');
    wasOnAtSignOut();
    await subscribeDevice(MEMBER, NEW_KEY);
    expect(pushTurnedOffHere(MEMBER)).toBe(false);
    expect(pushResumesHere(MEMBER)).toBe(false);
  });

  it('a failed switch-on keeps the earlier switch-off (CodeRabbit on #1024)', async () => {
    localStorage.setItem(offKey, '1');
    supabaseMock.insert.mockResolvedValueOnce({
      error: { code: '23514', message: 'push_devices_limit' },
    });

    await expect(subscribeDevice(MEMBER, NEW_KEY)).rejects.toBeTruthy();

    expect(pushTurnedOffHere(MEMBER)).toBe(true);
    wasOnAtSignOut();
    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
  });

  it('does nothing where storage cannot keep a switch-off (CodeRabbit on #1024)', async () => {
    wasOnAtSignOut();
    // A private window whose storage refuses writes: an off could not be
    // recorded, so nothing is switched on by itself.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('a switch-off queued behind a switch-on stays recorded', async () => {
    installLocks();

    await Promise.all([
      subscribeDevice(MEMBER, NEW_KEY),
      unsubscribeDevice(MEMBER, { turnedOff: true }),
    ]);

    expect(pushTurnedOffHere(MEMBER)).toBe(true);
    expect(pushOnHere(MEMBER)).toBe(false);
  });

  it('never asks: without a granted permission nothing is read or changed', async () => {
    wasOnAtSignOut();
    browser.permission = 'default';

    renderHook(() => usePushSelfRepair(), { wrapper });
    expect(await autoEnableDevice(MEMBER, NEW_KEY)).toBe('skipped');

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('does nothing in a build without the VAPID key', async () => {
    wasOnAtSignOut();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');

    renderHook(() => usePushSelfRepair(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('never adopts a subscription this Member has no row for', async () => {
    wasOnAtSignOut();
    // Another Member's leftover on a shared device (their session expired).
    const leftover = fakeSubscription('https://push.example.test/x', NEW_KEY);
    browser.current = leftover;
    rowPresent(false);

    renderHook(() => usePushSelfRepair(), { wrapper });
    await waitFor(() => expect(supabaseMock.maybeSingle).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(leftover.unsubscribe).not.toHaveBeenCalled();
  });

  it('subscribes once when several tabs start together', async () => {
    installLocks();
    wasOnAtSignOut();

    const outcomes = await Promise.all([
      autoEnableDevice(MEMBER, NEW_KEY),
      autoEnableDevice(MEMBER, NEW_KEY),
    ]);

    expect(outcomes).toEqual(['enabled', 'skipped']);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(supabaseMock.insert).toHaveBeenCalledTimes(1);
  });

  it('a switch-off waiting behind it in another tab wins', async () => {
    installLocks();
    wasOnAtSignOut();
    rowPresent(true);

    await Promise.all([
      autoEnableDevice(MEMBER, NEW_KEY),
      unsubscribeDevice(MEMBER, { turnedOff: true }),
    ]);

    expect(pushOnHere(MEMBER)).toBe(false);
    expect(pushTurnedOffHere(MEMBER)).toBe(true);
    expect(browser.current).toBeNull();
  });

  it('a switch-off that lands while it waits for the lock stops it', async () => {
    installLocks();
    wasOnAtSignOut();
    // Another device change holds the lock first.
    let release!: () => void;
    const held = navigator.locks.request(
      'osubb-push-device',
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const auto = autoEnableDevice(MEMBER, NEW_KEY);
    localStorage.setItem(offKey, '1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await held;

    expect(await auto).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it('a resume used up while it waits for the lock stops it', async () => {
    installLocks();
    wasOnAtSignOut();
    let release!: () => void;
    const held = navigator.locks.request(
      'osubb-push-device',
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const auto = autoEnableDevice(MEMBER, NEW_KEY);
    localStorage.removeItem(resumeKey);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await held;

    expect(await auto).toBe('skipped');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });
});
