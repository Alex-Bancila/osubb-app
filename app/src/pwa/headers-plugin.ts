import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const PLACEHOLDER = /__SUPABASE_HOST__/g;

/**
 * `_headers.template` with the Supabase host filled in (ruling L12, #770).
 * Throws when the URL is missing, unparseable or not http(s): a deployed
 * build without it cannot reach its backend, and a CSP naming no Supabase
 * host would block every request once it is enforced.
 */
function renderHeaders(template: string, supabaseUrl: string | undefined) {
  let host = '';
  try {
    const url = new URL(supabaseUrl ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') host = url.host;
  } catch {
    host = '';
  }
  if (!host)
    throw new Error(
      `_headers: VITE_SUPABASE_URL must be an absolute http(s) URL, got ${JSON.stringify(supabaseUrl ?? null)}.`,
    );
  return template.replace(PLACEHOLDER, host);
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
