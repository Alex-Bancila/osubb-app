/**
 * VAPID public keys as bytes and as base64url text, with no dependency, so
 * both the app and the service worker (#769) can use them.
 */

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

/** Bytes as unpadded base64url, the form `VITE_VAPID_PUBLIC_KEY` is in. */
export function bytesToUrlBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = '';
  for (const byte of view) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The key a subscription was made with, as unpadded base64url, or `null`
 * when the browser does not say (`options.applicationServerKey` is missing
 * on some older engines).
 */
export function subscriptionServerKey(
  subscription: PushSubscription,
): string | null {
  const key = subscription.options?.applicationServerKey;
  return key ? bytesToUrlBase64(key) : null;
}

/** A configured key in the same form, whatever padding or alphabet it used. */
export function normalizeUrlBase64(value: string): string {
  return value
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
