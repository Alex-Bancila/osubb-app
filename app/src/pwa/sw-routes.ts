/**
 * The service worker's routing rules, outside `sw.ts` so Vitest can check
 * the cache boundary without a worker runtime.
 */

/** Magic-link landings must reach the network, never the cached shell. */
export const NAVIGATION_DENYLIST = [/^\/auth\/callback(?:[/?]|$)/];

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
