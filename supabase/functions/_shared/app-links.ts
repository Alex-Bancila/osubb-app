// Links into the app from outside it: a push notification's tap (#778) and
// an Email Digest's lines (#775). Both resolve an in-app route against the
// app's own https origin, and never let a stored link leave the app.

import { allowedOrigins } from "./cors.ts";

/** Where a notification without a usable link opens: the notification list. */
export const NOTIFICATIONS_PATH = "/notificari";

/**
 * The app's origin: the first ALLOWED_ORIGINS entry (the same setting that
 * lets the app call invite-member), or null when it is not an https origin --
 * the local default, a malformed entry, or an environment where the setting
 * was never made. A link built from null would point at localhost.
 */
export function appOriginOf(origins: readonly string[]): string | null {
  const first = origins[0];
  if (!first) return null;
  try {
    const url = new URL(first);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** appOriginOf the function's own ALLOWED_ORIGINS. */
export function appOrigin(): string | null {
  return appOriginOf(allowedOrigins());
}

/**
 * The absolute URL a link opens -- the same rule as the service worker's
 * `targetUrl` in app/src/pwa/push-payload.ts. An in-app route (`/tracker/12`)
 * opens itself; anything else (absent, empty, protocol-relative, an absolute
 * URL that would leave the app) opens the notification list. The resolved
 * origin is checked too: the URL parser reads `/\host` (and a tab or new
 * line inside `//`) as another host.
 */
export function targetUrl(link: string | null, origin: string): string {
  const fallback = new URL(NOTIFICATIONS_PATH, origin);
  const trimmed = link?.trim() ?? "";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback.href;
  }
  const url = new URL(trimmed, origin);
  return url.origin === fallback.origin ? url.href : fallback.href;
}
