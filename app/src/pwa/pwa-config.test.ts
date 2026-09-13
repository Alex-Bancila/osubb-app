import { describe, expect, it } from 'vitest';
import { createPwaOptions, createWorkboxOptions } from './pwa-config';

function strategyFor(
  options: ReturnType<typeof createWorkboxOptions>,
  value: string,
) {
  const matches = options.runtimeCaching.filter((route) => {
    if (typeof route.urlPattern === 'string') return route.urlPattern === value;
    if (route.urlPattern instanceof RegExp) return route.urlPattern.test(value);
    throw new Error('PWA route matchers must be serializable');
  });
  return matches.map((route) => route.handler);
}

describe('PWA cache boundary', () => {
  it('keeps every Supabase API surface network-only', () => {
    const workbox = createWorkboxOptions('https://project.supabase.co');

    for (const path of [
      '/rest/v1/tasks',
      '/auth/v1/token',
      '/realtime/v1/websocket',
    ]) {
      expect(
        strategyFor(workbox, `https://project.supabase.co${path}`),
      ).toEqual(['NetworkOnly']);
    }
    expect(strategyFor(workbox, 'https://example.com/rest/v1/tasks')).toEqual(
      [],
    );
    expect(
      strategyFor(
        workbox,
        'https://project.supabase.co.evil.test/rest/v1/tasks',
      ),
    ).toEqual([]);
    expect(
      workbox.runtimeCaching.every((route) => route.handler === 'NetworkOnly'),
    ).toBe(true);
  });

  it('precaches only the static shell and keeps auth callbacks out of fallback', () => {
    const workbox = createWorkboxOptions('https://project.supabase.co');
    expect(workbox.globPatterns).toEqual([
      'index.html',
      'assets/*.{js,css,woff2,png,svg,ico}',
    ]);

    const [callbackDenylist] = workbox.navigateFallbackDenylist;
    expect(callbackDenylist).toBeInstanceOf(RegExp);
    if (!(callbackDenylist instanceof RegExp))
      throw new Error('Missing callback denylist');
    expect(callbackDenylist.test('/auth/callback')).toBe(true);
    expect(callbackDenylist.test('/auth/callback/')).toBe(true);
    expect(callbackDenylist.test('/auth/callback?code=magic-link-code')).toBe(
      true,
    );
    expect(callbackDenylist.test('/calendar')).toBe(false);
  });

  it('publishes the Romanian install manifest with official square icons', () => {
    const options = createPwaOptions('https://project.supabase.co');
    expect(options.registerType).toBe('prompt');
    expect(options.manifest).toMatchObject({
      name: 'OSUBB',
      short_name: 'OSUBB',
      lang: 'ro',
      display: 'standalone',
      theme_color: '#ED2025',
      background_color: '#FFFFFF',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', purpose: 'any maskable' },
        { src: '/pwa-512x512.png', sizes: '512x512', purpose: 'any maskable' },
      ],
    });
  });
});
