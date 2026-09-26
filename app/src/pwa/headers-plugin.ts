import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * `_headers.template` with the Supabase origins filled in (ruling L12, #770):
 * `__SUPABASE_ORIGIN__` for REST, Auth and Functions, and
 * `__SUPABASE_REALTIME_ORIGIN__` for the Realtime socket, which supabase-js
 * opens on the same origin with `http` swapped for `ws` (so `wss://` on every
 * hosted project). Throws when the URL is missing, unparseable or not
 * http(s): a deployed build without it cannot reach its backend, and a CSP
 * naming no Supabase origin would block every request once it is enforced.
 */
function renderHeaders(template: string, supabaseUrl: string | undefined) {
  let url: URL | null = null;
  try {
    url = new URL(supabaseUrl ?? '');
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    throw new Error(
      `_headers: VITE_SUPABASE_URL must be an absolute http(s) URL, got ${JSON.stringify(supabaseUrl ?? null)}.`,
    );
  const realtimeOrigin = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  return template
    .replace(/__SUPABASE_ORIGIN__/g, url.origin)
    .replace(/__SUPABASE_REALTIME_ORIGIN__/g, realtimeOrigin);
}

/**
 * Emits `dist/_headers` for Cloudflare Pages on `vite build`. The file is a
 * bundle asset outside `assets/`, so the service worker's precache globs
 * (`pwa-config.ts`) never pick it up.
 */
function headersPlugin(): Plugin {
  let source = '';
  return {
    name: 'osubb-cloudflare-headers',
    apply: 'build',
    configResolved(config) {
      const template = readFileSync(
        path.resolve(config.root, 'src/pwa/_headers.template'),
        'utf8',
      );
      source = renderHeaders(template, config.env.VITE_SUPABASE_URL);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source });
    },
  };
}

export { headersPlugin, renderHeaders };
