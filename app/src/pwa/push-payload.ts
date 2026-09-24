/**
 * The pure half of the service worker's push handling (#704, ADR-0010), kept
 * out of `sw.ts` so Vitest covers it without a worker runtime.
 *
 * `send-push` (#703) sends exactly `{ id, title, body, link }` — the
 * Notification's own row and nothing else.
 */
export type PushPayload = {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
};

/** Where a notification without a usable link opens: the notification list. */
export const NOTIFICATIONS_PATH = '/notificari';

/**
 * The payload, or `null` for anything malformed — the worker then shows
 * nothing rather than an empty or garbled system notification.
 */
export function parsePushPayload(text: string | null | undefined) {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { id, title, body, link } = value as Record<string, unknown>;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (body !== null && body !== undefined && typeof body !== 'string')
    return null;
  if (link !== null && link !== undefined && typeof link !== 'string')
    return null;
  return {
    id,
    title,
    body: body ?? null,
    link: link ?? null,
  } satisfies PushPayload;
}

/**
 * The absolute URL a tap opens. Notification links are in-app routes
 * (`/tracker/12`); anything else — absent, empty, protocol-relative or an
 * absolute URL that would leave the app — opens the notification list, the
 * same rule the in-app list applies (`inAppLink`).
 */
export function targetUrl(link: string | null | undefined, origin: string) {
  const trimmed = link?.trim() ?? '';
  const path =
    trimmed.startsWith('/') && !trimmed.startsWith('//')
      ? trimmed
      : NOTIFICATIONS_PATH;
  return new URL(path, origin).href;
}

/** The slice of the worker's `Clients` and `WindowClient` a tap needs. */
type WindowClientLike = {
  url: string;
  focus(): Promise<WindowClientLike>;
  navigate(url: string): Promise<WindowClientLike | null>;
};
type ClientsLike = {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
};

/**
 * Focus an open app window and take it to `url`, or open a new one. A window
 * the worker does not control cannot be navigated (`navigate` rejects), so it
 * falls back to a new window rather than leaving the tap doing nothing.
 */
export async function focusOrOpen(
  clients: ClientsLike,
  url: string,
  origin: string,
) {
  const windows = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const existing = windows.find((client) => {
    try {
      return new URL(client.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (existing) {
    try {
      const focused = await existing.focus();
      await focused.navigate(url);
      return;
    } catch {
      // Uncontrolled or gone: open a fresh window below.
    }
  }
  await clients.openWindow(url);
}
