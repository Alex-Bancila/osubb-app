import { supabase } from './supabase';

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

/** A base64url VAPID key as the bytes `PushManager.subscribe` expects. */
export function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1)
    bytes[index] = raw.charCodeAt(index);
  return bytes;
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

  const { data, error } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('member_id', memberId)
    .eq('token', tokenFor(subscription))
    .maybeSingle();
  if (error) throw error;
  return data !== null;
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
    const { error: staleRowError } = await supabase
      .from('push_tokens')
      .delete()
      .eq('member_id', memberId)
      .eq('token', tokenFor(stale));
    if (staleRowError) throw staleRowError;
    await stale.unsubscribe();
    subscription = await registration.pushManager.subscribe(options);
  }

  const { error } = await supabase.from('push_tokens').insert({
    member_id: memberId,
    token: tokenFor(subscription),
    platform: WEB_PLATFORM,
  });
  if (error && error.code !== '23505') throw error;
}

/**
 * Unsubscribe this browser and delete its row. The row is deleted even when
 * the browser's own unsubscribe fails: without the row nothing is sent here,
 * which is what turning the switch off promises.
 */
export async function unsubscribeDevice(memberId: string): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const token = tokenFor(subscription);

  try {
    await subscription.unsubscribe();
  } catch {
    // The row delete below is what stops delivery.
  }

  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('member_id', memberId)
    .eq('token', token);
  if (error) throw error;
}
