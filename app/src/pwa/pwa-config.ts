import type { VitePWAOptions } from 'vite-plugin-pwa';

function createWorkboxOptions(supabaseUrl: string) {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const escapedOrigin = supabaseOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
    globPatterns: ['index.html', 'assets/*.{js,css,woff2,png,svg,ico}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/auth\/callback(?:[/?]|$)/],
    runtimeCaching: [
      {
        urlPattern: new RegExp(`^${escapedOrigin}(?:/|$)`),
        handler: 'NetworkOnly',
      },
    ],
  } satisfies VitePWAOptions['workbox'];
}

function createPwaOptions(supabaseUrl: string) {
  return {
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
    workbox: createWorkboxOptions(supabaseUrl),
  } satisfies Partial<VitePWAOptions>;
}

export { createPwaOptions, createWorkboxOptions };
