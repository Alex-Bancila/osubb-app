import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * The service worker is our own `src/pwa/sw.ts` (ADR-0010, #704): Web Push
 * needs `push` and `notificationclick` handlers, which `generateSW` cannot
 * carry. The plugin still injects the precache manifest; the routing rules
 * that used to live here (navigation fallback, `/auth/*` link denylist,
 * network-only Supabase) are in `sw.ts` and `sw-routes.ts`.
 */
function createInjectManifestOptions() {
  return {
    /* `theme-init.js` is the blocking theme script `index.html` loads from
       `<head>` (#770): an offline start needs it as much as the shell. The
       Cloudflare `_headers` file matches none of these and stays out. */
    globPatterns: [
      'index.html',
      'theme-init.js',
      'assets/*.{js,css,woff2,png,svg,ico}',
    ],
  } satisfies VitePWAOptions['injectManifest'];
}

function createPwaOptions() {
  return {
    strategies: 'injectManifest',
    srcDir: 'src/pwa',
    filename: 'sw.ts',
    registerType: 'prompt',
    includeAssets: ['icon.png'],
    manifest: {
      name: 'OSUBB',
      short_name: 'OSUBB',
      description: 'Aplicația internă OSUBB',
      lang: 'ro',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#ED2025',
      background_color: '#FFFFFF',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    injectManifest: createInjectManifestOptions(),
  } satisfies Partial<VitePWAOptions>;
}

export { createInjectManifestOptions, createPwaOptions };
