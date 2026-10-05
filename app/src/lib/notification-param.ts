/**
 * The Notification a link from outside the app opened (#1012, ruling R37).
 *
 * A push tap (the service worker, and Safari's Declarative Web Push
 * `navigate`) and an Email Digest line open the Notification's target with
 * `?notificare=<id>`; the app marks that one row read on arrival and removes
 * the parameter. `send-push` and `send-digest` build the same URL
 * (`supabase/functions/_shared/app-links.ts`, `notificationUrl`).
 *
 * Nothing here touches the page: the service worker imports this file too.
 */
export const NOTIFICATION_PARAM = 'notificare';

/** `url` (absolute) with the Notification's id added to its query. */
export function withNotificationParam(url: string, id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) return url;
  const target = new URL(url);
  target.searchParams.set(NOTIFICATION_PARAM, String(id));
  return target.href;
}

/** The id a link carried, or `null` when it carried none or nonsense. */
export function openedNotificationId(search: string): number | null {
  const value = new URLSearchParams(search).get(NOTIFICATION_PARAM);
  if (value === null || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** `search` without the parameter: `''` or `?rest`. */
export function withoutNotificationParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(NOTIFICATION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
