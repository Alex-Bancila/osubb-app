import { commandReason } from './command-reasons';
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

/**
 * Forget that push is on here for a Member whose session ended without the
 * sign-out button (expiry, another tab, a forced sign-out). Clears the flag
 * only: the browser subscription may already belong to the next Member.
 */
export function forgetPushOn(memberId: string) {
  rememberPushOn(memberId, false);
}

function rememberPushOn(memberId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(pushOnKey(memberId), '1');
    else localStorage.removeItem(pushOnKey(memberId));
  } catch {
    // Without storage the self-repair only works while the row exists.
  }
}

/**
 * Whether this Member turned push off on this device with the switch
 * (2026-10-06). The push-on flag above cannot say it: it is absent both for
 * "never chose" and for "turned off", and a sign-out or an expired session
 * clears it too. Only this flag stops {@link autoEnableDevice}; turning push
 * on again (the switch, or Acasă's card) clears it. A sign-out never sets
 * it: it deletes this device's row so the next person on a shared device gets
 * nothing of this Member's, but the Member who signs in again here is the one
 * the pushes are for. Storage that throws reads as "not turned off", so
 * {@link autoEnableDevice} does nothing where storage cannot be written: a
 * switch-off it could not record must not be undone (CodeRabbit on #1024).
 */
function pushOffKey(memberId: string) {
  return `osubb.push-off.${memberId}`;
}

export function pushTurnedOffHere(memberId: string): boolean {
  try {
    return localStorage.getItem(pushOffKey(memberId)) === '1';
  } catch {
    return false;
  }
}

/** Whether this browser can keep the switch-off at all (a probe write). */
function canRememberPushOff(): boolean {
  try {
    localStorage.setItem('osubb.push-off.probe', '1');
    localStorage.removeItem('osubb.push-off.probe');
    return true;
  } catch {
    return false;
  }
}

function rememberPushOff(memberId: string, off: boolean) {
  try {
    if (off) localStorage.setItem(pushOffKey(memberId), '1');
    else localStorage.removeItem(pushOffKey(memberId));
  } catch {
    // Nothing to keep: see pushTurnedOffHere.
  }
}

/**
 * The token this browser last stored for a Member (2026-10-06). When the
 * browser loses or replaces its subscription without the app seeing the old
 * one (production: a Chrome on Windows dropped its subscription overnight),
 * the old row stayed behind until a push to it came back `404`/`410`, and
 * those leftovers filled the five-device cap (`push_devices_limit`), so the
 * self-repair and the switch were both refused. Storing a new token for this
 * browser now replaces the remembered one: one row per browser. It is this
 * browser's own earlier row for the same Member, so deleting it never touches
 * another device. Kept across `forgetPushOn`: it names a row, not consent.
 */
function lastTokenKey(memberId: string) {
  return `osubb.push-token.${memberId}`;
}

function rememberedToken(memberId: string): string | null {
  try {
    return localStorage.getItem(lastTokenKey(memberId));
  } catch {
    return null;
  }
}

function rememberToken(memberId: string, token: string | null) {
  try {
    if (token) localStorage.setItem(lastTokenKey(memberId), token);
    else localStorage.removeItem(lastTokenKey(memberId));
  } catch {
    // Without storage a lost subscription's row waits for its 404/410.
  }
}

/**
 * Run one device change at a time across every tab of this browser
 * (2026-10-06). Production showed five tabs repairing at once: five inserts
 * in 50 ms, two of them new subscriptions, so one browser held two rows. The
 * Web Locks API serializes them; where it is missing, the change runs as is.
 */
const DEVICE_LOCK = 'osubb-push-device';

function withDeviceLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return work();
  return locks.request(DEVICE_LOCK, work) as Promise<T>;
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
  rememberToken(memberId, token);
}

/**
 * Store the row for a subscription, then delete the rows it replaces: the
 * one named, and the one this browser stored last ({@link rememberedToken}).
 * At the five-device cap (security pass M2, `push_devices_limit`) the new
 * row cannot sit beside the old ones even for a moment, so they go first and
 * the store is tried once more.
 */
async function replaceRow(
  memberId: string,
  freshToken: string,
  staleToken: string | null,
): Promise<void> {
  const stale = [
    ...new Set(
      [staleToken, rememberedToken(memberId)].filter(
        (token): token is string => token !== null && token !== freshToken,
      ),
    ),
  ];
  try {
    await storeRow(memberId, freshToken);
  } catch (error) {
    if (stale.length === 0 || commandReason(error) !== 'push_devices_limit')
      throw error;
    for (const token of stale) await deleteRow(memberId, token);
    await storeRow(memberId, freshToken);
    return;
  }
  for (const token of stale) await deleteRow(memberId, token);
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
 * Self-repair (#769, ADR-0010, ruling L8). Push is on here when the Member's
 * row for this browser's subscription exists, or when they turned it on on
 * this device ({@link pushOnHere}). If it is on and
 *
 * - the subscription was made with another key than `publicKey` (the VAPID
 *   pair was rotated: every push to it would fail with 401/403), or
 * - the row is missing (a `404`/`410` removed it, or `pushsubscriptionchange`
 *   replaced the subscription while no window was open), or
 * - the browser holds no subscription at all,
 *
 * it unsubscribes, subscribes again with `publicKey`, stores the new row and
 * then deletes the stale ones (the old subscription's and the one this
 * browser stored last), silently. Nothing happens without a granted
 * permission: subscribing must never prompt from here. Runs under the device
 * lock, so tabs opening together repair once (2026-10-06).
 */
export async function repairDevice(
  memberId: string,
  publicKey: string,
): Promise<RepairOutcome> {
  if (!pushSupported() || Notification.permission !== 'granted')
    return 'skipped';
  return withDeviceLock(() => repairUnlocked(memberId, publicKey));
}

async function repairUnlocked(
  memberId: string,
  publicKey: string,
): Promise<RepairOutcome> {
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
  if (subscription && rowExists && keyMatches) {
    rememberToken(memberId, token);
    return 'healthy';
  }

  // The old row goes only once the new one is stored: if resubscribing
  // fails, the row stays for the next start, which tries again. A missing row
  // gets a new subscription too: a 404/410 removed it because the push
  // service no longer knows that subscription, whatever the browser says.
  if (subscription) await subscription.unsubscribe().catch(() => false);
  const fresh = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await replaceRow(memberId, tokenFor(fresh), rowExists ? token : null);
  return 'repaired';
}

/**
 * What the switch shows (2026-10-06): this device is subscribed, and if it
 * is not although the Member turned push on here and the permission is still
 * granted, the self-repair runs first and the answer is read again. So the
 * switch never reads "off" for a subscription the browser dropped while the
 * app sat in the background; it reads off only when the Member turned it off,
 * the permission is gone, or the repair itself was refused.
 */
export async function readDevice(
  memberId: string,
  publicKey: string | null,
): Promise<boolean> {
  if (await isDeviceSubscribed(memberId)) return true;
  if (
    !publicKey ||
    !pushOnHere(memberId) ||
    Notification.permission !== 'granted'
  )
    return false;
  const outcome = await repairDevice(memberId, publicKey).catch(
    () => 'skipped' as const,
  );
  return outcome === 'repaired' ? isDeviceSubscribed(memberId) : false;
}

/**
 * The service worker resubscribed after `pushsubscriptionchange` (#769):
 * store the new subscription's row and drop the old one's. Only for a Member
 * whose old row existed or who has push on here, so a subscription another
 * Member left behind is never adopted. Returns whether it stored anything.
 */
export function storeRenewedSubscription(
  memberId: string,
  subscription: PushSubscriptionJSON,
  oldSubscription: PushSubscriptionJSON | null,
): Promise<boolean> {
  return withDeviceLock(async () => {
    const oldToken = oldSubscription ? JSON.stringify(oldSubscription) : null;
    const hadRow = oldToken ? await hasRow(memberId, oldToken) : false;
    if (!hadRow && !pushOnHere(memberId)) return false;
    rememberPushOn(memberId, true);
    await replaceRow(
      memberId,
      JSON.stringify(subscription),
      hadRow ? oldToken : null,
    );
    return true;
  });
}

/**
 * Subscribe this browser and store its row. Permission must already be
 * granted. Re-enabling is idempotent: `subscribe` returns the existing
 * subscription, and the `(member_id, token)` unique key turns a repeated
 * insert into `23505`, which counts as subscribed. A row this browser stored
 * earlier for a subscription it has since lost is replaced, not kept beside.
 */
export function subscribeDevice(
  memberId: string,
  publicKey: string,
): Promise<void> {
  return withDeviceLock(async () => {
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_TIMEOUT_MS,
    );
    await subscribeUnlocked(memberId, publicKey, registration);
    // The Member chose on and it took: a switch-off from before no longer
    // holds. Only now: a failed attempt (the five-device cap, a stalled
    // worker) must not leave push to switch itself on later (CodeRabbit).
    rememberPushOff(memberId, false);
  });
}

/**
 * Switch push on by itself where the browser already grants the permission
 * (2026-10-06, Alex: "set by default the notification as approved and on").
 * Only when the permission is `granted` (so nothing can prompt), the Member
 * never turned push off on this device ({@link pushTurnedOffHere}), and the
 * browser holds no subscription at all, and storage can keep a switch-off
 * (otherwise one could never be recorded): one it holds without this Member's
 * row (the self-repair has already looked) may be another Member's leftover
 * on a shared device, and is never adopted. Same path as the switch, under
 * the device lock, so tabs opening together subscribe once.
 */
export async function autoEnableDevice(
  memberId: string,
  publicKey: string,
): Promise<'enabled' | 'skipped'> {
  if (
    !pushSupported() ||
    Notification.permission !== 'granted' ||
    !canRememberPushOff() ||
    pushTurnedOffHere(memberId)
  )
    return 'skipped';
  return withDeviceLock(async () => {
    // Again under the lock: a switch-off that landed while this waited wins.
    if (pushTurnedOffHere(memberId)) return 'skipped';
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_TIMEOUT_MS,
    );
    if (await registration.pushManager.getSubscription()) return 'skipped';
    await subscribeUnlocked(memberId, publicKey, registration);
    return 'enabled';
  });
}

async function subscribeUnlocked(
  memberId: string,
  publicKey: string,
  registration: ServiceWorkerRegistration,
): Promise<void> {
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

  await replaceRow(memberId, tokenFor(subscription), null);
  rememberPushOn(memberId, true);
}

/**
 * Unsubscribe this browser and delete its row, and the row this browser
 * stored last if the subscription behind it was lost. The rows are deleted
 * even when the browser's own unsubscribe fails: without them nothing is sent
 * here, which is what turning the switch off (or signing out) promises.
 */
export async function unsubscribeDevice(
  memberId: string,
  { turnedOff = false }: { turnedOff?: boolean } = {},
): Promise<void> {
  // Off is off even if what follows fails: the self-repair must not turn it
  // back on (#769). The switch also records the choice, so push is not
  // switched on again by itself (2026-10-06); a sign-out does not.
  rememberPushOn(memberId, false);
  if (turnedOff) rememberPushOff(memberId, true);
  return withDeviceLock(async () => {
    // Again under the lock: a repair or renewal that held it may have set
    // the flag after the first clear, and an enable queued before this one
    // may have lifted the switch-off: off must stay off.
    rememberPushOn(memberId, false);
    if (turnedOff) rememberPushOff(memberId, true);
    const subscription = await currentSubscription();
    const token = subscription ? tokenFor(subscription) : null;
    const remembered = rememberedToken(memberId);

    if (subscription) {
      try {
        await subscription.unsubscribe();
      } catch {
        // The row delete below is what stops delivery.
      }
    }

    if (token) await deleteRow(memberId, token);
    if (remembered && remembered !== token)
      await deleteRow(memberId, remembered);
    rememberToken(memberId, null);
  });
}
