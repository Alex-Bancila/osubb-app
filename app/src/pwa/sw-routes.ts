/**
 * The service worker's routing rules, outside `sw.ts` so Vitest can check
 * the cache boundary without a worker runtime.
 */

/**
 * Emailed-link landings — `/auth/callback` and the click-to-confirm page
 * `/auth/confirm` (#768) — must reach the network, never the cached shell.
 */
export const NAVIGATION_DENYLIST = [/^\/auth\/(?:callback|confirm)(?:[/?]|$)/];

/**
 * The Formatted Text editor's chunk (R60, §C): Vite's
 * `assets/FormattedTextEditor-<hash>.js`, left out of the precache
 * (`pwa-config.ts`) since only a form that publishes needs it, and kept in its
 * own cache from the first form that loads it. Same origin only.
 */
export function isEditorChunk(url: URL, origin: string): boolean {
  return (
    url.origin === origin &&
    /^\/assets\/FormattedTextEditor-[\w-]+\.js$/.test(url.pathname)
  );
}

/**
 * Whether an answer for the editor's chunk may go into its cache: a success,
 * and JavaScript. After a Release, Cloudflare Pages (in SPA mode: there is no
 * `404.html`) answers an old chunk's address with `index.html` and a 200;
 * cached under that address, the page would stand in for the script.
 */
export function isCacheableEditorChunk(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return (
    response.ok &&
    /^(?:application|text)\/(?:x-)?javascript\s*(?:;|$)/i.test(type)
  );
}

/**
 * Matches every request to the Supabase origin (REST, Auth, Realtime,
 * Functions), which the worker sends network-only: member data is never
 * cached. `null` when the build carried no usable URL, so the worker still
 * installs — without a route, those requests go to the network anyway.
 */
export function supabaseOriginPattern(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;
  let origin: string;
  try {
    origin = new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:/|$)`);
}
