import { supabase } from './supabase';
import {
  normalizeUrlBase64,
  subscriptionServerKey,
  urlBase64ToUint8Array,
} from './vapid-key';

export { urlBase64ToUint8Array };

/**
 * This browser as a Web Push device (#704, ADR-0010): the `PushManager`
 * subscription and the member's `push_tokens` row that `send-push` (#703)
 * delivers to. No React here, so the sign-out in `auth.tsx` can remove this
 * device's row without importing a hook; `usePushSubscription()` in
 * `queries/push-subscription.ts` is the screen-facing half.
 *
 * `push_tokens` is not a command-owned table: its self-only insert and delete
 * policies (#66) are the sanctioned path, and nothing here updates a row.
 */

/** `push_tokens.platform` for a browser subscription. */
const WEB_PLATFORM = 'web';

/** How long `enable` waits for the service worker to be active. */
const SERVICE_WORKER_TIMEOUT_MS = 10_000;

/**
 * Web Push needs a service worker, the Push API and notifications. iOS
 * exposes the last two only to the app installed on the home screen.
 */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The environment's VAPID public key, or `null` when the build has none. */
export function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

/**
 * Whether this Member turned push on on this device (#769): set when the
 * switch subscribes or a row is found for this browser's subscription,
 * cleared when the switch or sign-out unsubscribes. It is what lets the
 * self-repair tell "my row went missing" from "another Member's subscription
 * was left behind" -- the latter is never taken over silently. Per browser
 * and per Member; storage that throws (a private window) reads as off.
 */
function pushOnKey(memberId: string) {
  return `osubb.push-on.${memberId}`;
}

export function pushOnHere(memberId: string): boolean {
  try {
    return localStorage.getItem(pushOnKey(memberId)) === '1';
  } catch {
    return false;
  }
}

function rememberPushOn(memberId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(pushOnKey(memberId), '1');
    else localStorage.removeItem(pushOnKey(memberId));
  } catch {
    // Without storage the self-repair only works while the row exists.
  }
}

/** What `push_tokens.token` holds: the subscription JSON `send-push` reads. */
export function tokenFor(subscription: PushSubscription): string {
  return JSON.stringify(subscription.toJSON());
}

/** Rejects after `ms`, so a stalled browser API never blocks the caller. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * This browser's current subscription, or `null`. Reads the registration
 * without waiting for one (`getRegistration`, not `ready`), so a page with no
 * service worker — the dev server — answers at once instead of hanging.
 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * True when this browser holds a subscription and the member's row for it
 * exists — both halves, so a subscription whose row `send-push` removed after
 * a `410`, or one another member left behind, reads as off.
 */
export async function isDeviceSubscribed(memberId: string): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) return false;
  return hasRow(memberId, tokenFor(subscription));
}

/** Whether the Member's `push_tokens` row for this token exists. */
async function hasRow(memberId: string, token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('member_id', memberId)
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Store the Member's row for a token; an existing one (`23505`) is fine. */
async function storeRow(memberId: string, token: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').insert({
    member_id: memberId,
    token,
    platform: WEB_PLATFORM,
  });
  if (error && error.code !== '23505') throw error;
}

/** Delete the Member's row for a token, if there is one. */
async function deleteRow(memberId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('member_id', memberId)
    .eq('token', token);
  if (error) throw error;
}

export type RepairOutcome = 'healthy' | 'skipped' | 'repaired';

/**
 * App-start self-repair (#769, ADR-0010, ruling L8). Push is on here when
 * the Member's row for this browser's subscription exists, or when they
 * turned it on on this device ({@link pushOnHere}). If it is on and
 *
 * - the subscription was made with another key than `publicKey` (the VAPID
 *   pair was rotated: every push to it would fail with 401/403), or
 * - the row is missing (a `404`/`410` removed it, or `pushsubscriptionchange`
 *   replaced the subscription while no window was open), or
 * - the browser holds no subscription at all,
 *
 * it deletes the stale row, unsubscribes, subscribes again with `publicKey`
 * and stores the new row, silently. Nothing happens without a granted
 * permission: subscribing must never prompt from here.
 */
export async function repairDevice(
  memberId: string,
  publicKey: string,
): Promise<RepairOutcome> {
  if (!pushSupported() || Notification.permission !== 'granted')
    return 'skipped';

  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_TIMEOUT_MS,
  );
  const subscription = await registration.pushManager.getSubscription();
  const token = subscription ? tokenFor(subscription) : null;
  const rowExists = token ? await hasRow(memberId, token) : false;
  if (rowExists) rememberPushOn(memberId, true);
  if (!rowExists && !pushOnHere(memberId)) return 'skipped';

  const key = subscription ? subscriptionServerKey(subscription) : null;
  // A browser that does not report the key is trusted to hold the right one.
  const keyMatches = key === null || key === normalizeUrlBase64(publicKey);
  if (subscription && rowExists && keyMatches) return 'healthy';

  if (subscription && token) {
    if (rowExists) await deleteRow(memberId, token);
    await subscription.unsubscribe().catch(() => false);
  }
  const fresh = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await storeRow(memberId, tokenFor(fresh));
  return 'repaired';
}

/**
 * The service worker resubscribed after `pushsubscriptionchange` (#769):
 * store the new subscription's row and drop the old one's. Only for a Member
 * whose old row existed or who has push on here, so a subscription another
 * Member left behind is never adopted. Returns whether it stored anything.
 */
export async function storeRenewedSubscription(
  memberId: string,
  subscription: PushSubscriptionJSON,
  oldSubscription: PushSubscriptionJSON | null,
): Promise<boolean> {
  const oldToken = oldSubscription ? JSON.stringify(oldSubscription) : null;
  const hadRow = oldToken ? await hasRow(memberId, oldToken) : false;
  if (!hadRow && !pushOnHere(memberId)) return false;
  rememberPushOn(memberId, true);
  await storeRow(memberId, JSON.stringify(subscription));
  if (oldToken && hadRow) await deleteRow(memberId, oldToken);
  return true;
}

/**
 * Subscribe this browser and store its row. Permission must already be
 * granted. Re-enabling is idempotent: `subscribe` returns the existing
 * subscription, and the `(member_id, token)` unique key turns a repeated
 * insert into `23505`, which counts as subscribed.
 */
export async function subscribeDevice(
  memberId: string,
  publicKey: string,
): Promise<void> {
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_TIMEOUT_MS,
  );
  const options: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  };

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe(options);
  } catch (error) {
    // A subscription made with an earlier VAPID pair blocks a new one with
    // InvalidStateError (docs/backend/push.md: rotating the pair means
    // subscribing again). Only then: delete the stale row — send-push would
    // otherwise fail every delivery to it with 401/403, never removing it —
    // drop the stale subscription and try once more. Any other error is a
    // real failure and leaves a working subscription alone.
    if (!(error instanceof DOMException && error.name === 'InvalidStateError'))
      throw error;
    const stale = await registration.pushManager.getSubscription();
    if (!stale) throw error;
    await deleteRow(memberId, tokenFor(stale));
    await stale.unsubscribe();
    subscription = await registration.pushManager.subscribe(options);
  }

  await storeRow(memberId, tokenFor(subscription));
  rememberPushOn(memberId, true);
}

/**
 * Unsubscribe this browser and delete its row. The row is deleted even when
 * the browser's own unsubscribe fails: without the row nothing is sent here,
 * which is what turning the switch off promises.
 */
export async function unsubscribeDevice(memberId: string): Promise<void> {
  // Off is off even if what follows fails: the self-repair must not turn it
  // back on (#769).
  rememberPushOn(memberId, false);
  const subscription = await currentSubscription();
  if (!subscription) return;
  const token = tokenFor(subscription);

  try {
    await subscription.unsubscribe();
  } catch {
    // The row delete below is what stops delivery.
  }

  await deleteRow(memberId, token);
}
