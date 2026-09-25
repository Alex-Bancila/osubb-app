import { urlBase64ToUint8Array } from '../lib/vapid-key';

/**
 * The service worker's `pushsubscriptionchange` handling (#769, ADR-0010),
 * kept out of `sw.ts` so it can be tested without a worker. The browser fires
 * the event when the push service expires or replaces a subscription; the
 * worker subscribes again (unless the browser already did) and tells every
 * open window, whose `usePushSelfRepair` stores the new `push_tokens` row.
 * With no window open, the next app start finds the subscription without a
 * row and repairs it then.
 */

/** The `type` of the message the worker posts to the app's windows. */
export const PUSH_SUBSCRIPTION_CHANGED = 'osubb:push-subscription-changed';

export type PushSubscriptionChangedMessage = {
  type: typeof PUSH_SUBSCRIPTION_CHANGED;
  subscription: PushSubscriptionJSON;
  oldSubscription: PushSubscriptionJSON | null;
};

export function isPushSubscriptionChangedMessage(
  data: unknown,
): data is PushSubscriptionChangedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<PushSubscriptionChangedMessage>;
  return (
    message.type === PUSH_SUBSCRIPTION_CHANGED &&
    typeof message.subscription?.endpoint === 'string'
  );
}

/** The slices of the worker's `PushManager` and `Clients` renewal needs. */
type SubscriptionLike = {
  toJSON(): PushSubscriptionJSON;
  options?: { applicationServerKey?: ArrayBuffer | null };
};
type PushManagerLike = {
  subscribe(options: PushSubscriptionOptionsInit): Promise<SubscriptionLike>;
};
type ClientsLike = {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly { postMessage(message: unknown): void }[]>;
};

/**
 * Resubscribe after `pushsubscriptionchange` and post the new subscription to
 * every window. The build's VAPID key wins; without one, the old
 * subscription's key is reused. Returns the posted message, or `null` when
 * there was no key to subscribe with.
 */
export async function renewSubscription(
  pushManager: PushManagerLike,
  clients: ClientsLike,
  change: {
    oldSubscription: SubscriptionLike | null;
    newSubscription: SubscriptionLike | null;
  },
  publicKey: string | undefined,
): Promise<PushSubscriptionChangedMessage | null> {
  let subscription = change.newSubscription;
  if (!subscription) {
    const configured = publicKey?.trim();
    const applicationServerKey = configured
      ? urlBase64ToUint8Array(configured)
      : (change.oldSubscription?.options?.applicationServerKey ?? null);
    if (!applicationServerKey) return null;
    subscription = await pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const message: PushSubscriptionChangedMessage = {
    type: PUSH_SUBSCRIPTION_CHANGED,
    subscription: subscription.toJSON(),
    oldSubscription: change.oldSubscription?.toJSON() ?? null,
  };
  const windows = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of windows) client.postMessage(message);
  return message;
}
