import { describe, expect, it } from 'vitest';
import { createPwaOptions } from './pwa-config';
import {
  isEditorChunk,
  NAVIGATION_DENYLIST,
  supabaseOriginPattern,
} from './sw-routes';

describe('PWA build options', () => {
  it('builds our own service worker from src/pwa/sw.ts (ADR-0010)', () => {
    const options = createPwaOptions();
    expect(options.strategies).toBe('injectManifest');
    expect(options.srcDir).toBe('src/pwa');
    expect(options.filename).toBe('sw.ts');
    expect(options.registerType).toBe('prompt');
    expect(options).not.toHaveProperty('workbox');
  });

  it('precaches only the static shell, its stylesheet and its theme script', () => {
    expect(createPwaOptions().injectManifest.globPatterns).toEqual([
      'index.html',
      'splash.css',
      'theme-init.js',
      'assets/*.{js,css,woff2,png,svg,ico}',
    ]);
  });

  it('leaves the Formatted Text editor out of the precache (R60)', () => {
    expect(createPwaOptions().injectManifest.globIgnores).toEqual([
      'assets/FormattedTextEditor-*.js',
    ]);
  });

  it('publishes the Romanian install manifest with the app icon', () => {
    const options = createPwaOptions();
    expect(options.manifest).toMatchObject({
      name: 'OSUBB',
      short_name: 'OSUBB',
      lang: 'ro',
      display: 'standalone',
      theme_color: '#ED2025',
      background_color: '#FFFFFF',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', purpose: 'any' },
        {
          src: '/icon-maskable-192.png',
          sizes: '192x192',
          purpose: 'maskable',
        },
        {
          src: '/icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable',
        },
      ],
    });
  });
});

describe('service worker cache boundary', () => {
  it('keeps every Supabase API surface network-only, and nothing else', () => {
    const pattern = supabaseOriginPattern('https://project.supabase.co');
    if (!pattern) throw new Error('Missing Supabase route');

    for (const path of [
      '/rest/v1/tasks',
      '/auth/v1/token',
      '/realtime/v1/websocket',
      '/functions/v1/send-push',
    ]) {
      expect(pattern.test(`https://project.supabase.co${path}`)).toBe(true);
    }
    expect(pattern.test('https://example.com/rest/v1/tasks')).toBe(false);
    expect(
      pattern.test('https://project.supabase.co.evil.test/rest/v1/tasks'),
    ).toBe(false);
  });

  it('installs without a Supabase route when the build carried no URL', () => {
    expect(supabaseOriginPattern(undefined)).toBeNull();
    expect(supabaseOriginPattern('')).toBeNull();
    expect(supabaseOriginPattern('not a url')).toBeNull();
  });

  it('caches the Formatted Text editor’s chunk on first use, from this origin only (R60)', () => {
    const origin = 'https://app.osubb.ro';
    const chunk = (href: string) => isEditorChunk(new URL(href), origin);

    expect(chunk(`${origin}/assets/FormattedTextEditor-B3x_k-9Q.js`)).toBe(
      true,
    );

    expect(
      chunk('https://cdn.example.com/assets/FormattedTextEditor-a1.js'),
    ).toBe(false);
    expect(chunk(`${origin}/assets/FormattedText-a1.js`)).toBe(false);
    expect(chunk(`${origin}/assets/FormattedTextEditor-a1.css`)).toBe(false);
    expect(chunk(`${origin}/assets/index-a1.js`)).toBe(false);
    expect(chunk(`${origin}/x/assets/FormattedTextEditor-a1.js`)).toBe(false);
  });

  it('keeps emailed-link landings out of the navigation fallback', () => {
    const denied = (path: string) =>
      NAVIGATION_DENYLIST.some((pattern) => pattern.test(path));

    expect(denied('/auth/callback')).toBe(true);
    expect(denied('/auth/callback/')).toBe(true);
    expect(denied('/auth/callback?code=magic-link-code')).toBe(true);
    // The click-to-confirm page (#768) is never served from cache either.
    expect(denied('/auth/confirm')).toBe(true);
    expect(denied('/auth/confirm/')).toBe(true);
    expect(denied('/auth/confirm?token_hash=abc&type=invite')).toBe(true);

    expect(denied('/calendar')).toBe(false);
    expect(denied('/auth/confirmed')).toBe(false);
    expect(denied('/auth')).toBe(false);
  });
});
