// The push payload -- #703, #778, ADR-0010.
//
// One JSON object carries two shapes of the same Notification:
//
//   { id, title, body, link }        read by the service worker's `push`
//                                    handler (app/src/pwa/push-payload.ts)
//   { web_push: 8030,                Declarative Web Push (Safari 18.4+ on
//     notification: { title, body,   iOS, 18.5+ on macOS): the browser shows
//       navigate, tag, lang } }      it without waking the service worker
//
// A browser that does not know Declarative Web Push hands the whole object
// to the service worker, which reads its four keys and ignores the rest. No
// `mutable` key is sent, so Safari shows the declarative notification itself
// and never also runs the `push` handler: one notification either way.
//
// Nothing here is new data: the declarative half repeats the title and body,
// and `navigate` is the link the service worker would open on a tap.

import { targetUrl } from "../_shared/app-links.ts";

// Moved to _shared/app-links.ts for the Email Digest (#775); re-exported so
// the push side reads as before.
export {
  appOrigin,
  appOriginOf,
  NOTIFICATIONS_PATH,
  targetUrl,
} from "../_shared/app-links.ts";

/** The slice of a claimed outbox row that goes into the payload. */
export interface PushNotification {
  notification_id: number;
  title: string;
  body: string | null;
  link: string | null;
}

// A push message is one aes128gcm record of at most 4096 bytes (RFC 8030
// section 7.2, RFC 8291): 86 bytes of header, a 16-byte tag and a 1-byte
// padding delimiter leave 3993 bytes of plaintext. A longer payload is
// refused by the push service or split into records it does not accept. The
// budget keeps a margin below that.
export const MAX_PAYLOAD_BYTES = 3_800;

const ELLIPSIS = "…";

function serialize(
  id: number,
  title: string,
  body: string | null,
  link: string | null,
  origin: string | null,
): string {
  const legacy = { id, title, body, link };
  if (origin === null) return JSON.stringify(legacy);
  return JSON.stringify({
    ...legacy,
    web_push: 8030,
    notification: {
      title,
      ...(body === null ? {} : { body }),
      navigate: targetUrl(link, origin),
      // The tag the service worker uses, so a repeat replaces, never stacks.
      tag: `osubb-${id}`,
      lang: "ro",
    },
  });
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The first `count` code points of `text`, marked as cut when it was. */
function cut(text: string, count: number): string {
  const chars = Array.from(text);
  if (chars.length <= count) return text;
  return chars.slice(0, count).join("").trimEnd() + ELLIPSIS;
}

/** The largest n in [low, high] for which fits(n) holds, or low - 1. */
function largest(
  low: number,
  high: number,
  fits: (n: number) => boolean,
): number {
  let best = low - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * The payload for one Notification, at most `maxBytes` of UTF-8. When the
 * whole text does not fit, the body is cut first (on a code point, with an
 * ellipsis) -- it appears twice and is the only long field in practice. A
 * title or link long enough to overflow on its own is pathological: the link
 * is dropped (the tap then opens the notification list), then the title cut.
 */
export function buildPushPayload(
  row: PushNotification,
  origin: string | null,
  maxBytes: number = MAX_PAYLOAD_BYTES,
): string {
  const id = row.notification_id;
  let { title, body, link } = row;
  const fits = (payload: string) => byteLength(payload) <= maxBytes;

  const whole = serialize(id, title, body, link, origin);
  if (fits(whole)) return whole;

  if (body !== null) {
    const full = body;
    const keep = largest(
      1,
      Array.from(full).length - 1,
      (n) => fits(serialize(id, title, cut(full, n), link, origin)),
    );
    if (keep >= 1) return serialize(id, title, cut(full, keep), link, origin);
    body = null;
    const bare = serialize(id, title, body, link, origin);
    if (fits(bare)) return bare;
  }

  if (link !== null) {
    link = null;
    const unlinked = serialize(id, title, body, link, origin);
    if (fits(unlinked)) return unlinked;
  }

  const fullTitle = title;
  const keep = largest(
    1,
    Array.from(fullTitle).length - 1,
    (n) => fits(serialize(id, cut(fullTitle, n), body, link, origin)),
  );
  title = cut(fullTitle, Math.max(keep, 1));
  return serialize(id, title, body, link, origin);
}
