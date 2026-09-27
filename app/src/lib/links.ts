/**
 * The two link rules the app applies to anything it did not write itself —
 * a notification's `link`, a `next` or `redirect_to` in a query string, an
 * Attached Link or a form address stored on the server. One rule each way:
 *
 *   `sameOriginPath` — a path inside the app, or `/`.
 *   `safeHttpUrl`    — an absolute http(s) address, or `null`.
 *
 * Nothing at module level touches the page: the service worker imports this
 * file too (`pwa/push-payload.ts`) and passes its own origin.
 */

/** A space, tab, new line or other control character anywhere in `value`. */
function hasSpaceOrControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
}

/**
 * The path, query and fragment of `value` when it resolves to `origin`,
 * otherwise `null`. Only a root-relative path is accepted, and the checks run
 * on the raw text before the URL parser sees it: the parser strips tabs and
 * new lines and reads a backslash as a slash, so `/\t/evil.example` and
 * `/\evil.example` would otherwise resolve to another host. The resolved
 * origin is compared as well, as the last word.
 */
export function inAppPath(
  value: string | null | undefined,
  origin: string,
): string | null {
  const trimmed = value?.trim() ?? '';
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    hasSpaceOrControl(trimmed)
  )
    return null;
  try {
    const url = new URL(trimmed, origin);
    if (url.origin !== new URL(origin).origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/**
 * Where a server- or URL-provided path may send the Member: the same path
 * when it stays in the app, `/` for anything else — another host, a
 * protocol-relative `//host`, a backslash, a tab or new line, `javascript:`
 * or `data:`.
 */
export function sameOriginPath(
  value: string | null | undefined,
  origin: string = location.origin,
): string {
  return inAppPath(value, origin) ?? '/';
}

/**
 * An address safe to put in an `href` that leaves the app: `http://` or
 * `https://` only (any case), parsed by the URL parser, no whitespace or
 * control character anywhere — addresses arrive already normalised, so one
 * with a space around it was not written by the app. Anything else —
 * `javascript:`, `data:`, a bare host, a relative path — is `null`, and the
 * caller renders no link. A defensive re-check of the server's rule
 * (`private.is_http_url`, #673), for rows written before that guard existed.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value) || hasSpaceOrControl(value))
    return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
