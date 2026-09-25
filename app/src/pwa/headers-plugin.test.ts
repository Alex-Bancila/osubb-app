import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { headersPlugin, renderHeaders } from './headers-plugin';

const STAGING_URL = 'https://abcdefghijklmnop.supabase.co';
const STAGING_HOST = 'abcdefghijklmnop.supabase.co';
const template = readFileSync(
  path.resolve('src/pwa/_headers.template'),
  'utf8',
);

/** Cloudflare's `_headers` shape: an unindented path, then indented headers. */
function parseHeaders(file: string) {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of file.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const pathPattern = line.trim();
      if (rules.has(pathPattern))
        throw new Error(`duplicate rule ${pathPattern}`);
      current = new Map();
      rules.set(pathPattern, current);
      continue;
    }
    if (!current) throw new Error(`header before any path: ${line}`);
    const colon = line.indexOf(':');
    current.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return rules;
}

function directives(csp: string) {
  return new Map(
    csp.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe('Cloudflare _headers (ruling L12, #770)', () => {
  const rendered = renderHeaders(template, STAGING_URL);
  const rules = parseHeaders(rendered);

  it('substitutes the Supabase host everywhere', () => {
    expect(template).toContain('__SUPABASE_ORIGIN__');
    expect(template).toContain('__SUPABASE_REALTIME_ORIGIN__');
    expect(rendered).not.toMatch(/__SUPABASE_\w+__/);
    const all = rules.get('/*');
    const csp = directives(
      all?.get('Content-Security-Policy-Report-Only') ?? '',
    );
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      `https://${STAGING_HOST}`,
      `wss://${STAGING_HOST}`,
    ]);
  });

  it('ships the CSP report-only, scripts from self only', () => {
    const all = rules.get('/*');
    expect(all?.has('Content-Security-Policy')).toBe(false);
    const csp = directives(
      all?.get('Content-Security-Policy-Report-Only') ?? '',
    );
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });

  it('sets the security headers on every path', () => {
    expect(Object.fromEntries(rules.get('/*') ?? [])).toMatchObject({
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Robots-Tag': 'noindex',
    });
  });

  it('caches hashed assets for a year and revalidates the shell', () => {
    expect(rules.get('/assets/*')?.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    for (const shell of [
      '/',
      '/index.html',
      '/sw.js',
      '/manifest.webmanifest',
      '/theme-init.js',
    ]) {
      expect(rules.get(shell)?.get('Cache-Control'), shell).toBe('no-cache');
    }
    expect(rules.get('/auth/*')?.get('Cache-Control')).toBe('no-store');
  });

  it('never sets Cache-Control under /*, where Pages would join it', () => {
    expect(rules.get('/*')?.has('Cache-Control')).toBe(false);
  });

  it('refuses a build without a usable Supabase URL', () => {
    expect(() => renderHeaders(template, undefined)).toThrow(
      /VITE_SUPABASE_URL/,
    );
    expect(() => renderHeaders(template, '')).toThrow(/VITE_SUPABASE_URL/);
    expect(() => renderHeaders(template, 'not a url')).toThrow(
      /VITE_SUPABASE_URL/,
    );
    expect(() =>
      renderHeaders(template, 'ftp://abcdefghijklmnop.supabase.co'),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it('follows a local http URL with ws, as supabase-js does', () => {
    expect(renderHeaders(template, 'http://127.0.0.1:54321')).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321;",
    );
  });
});

describe('headersPlugin', () => {
  it('emits _headers at the root of dist on build', () => {
    const plugin = headersPlugin();
    expect(plugin.apply).toBe('build');

    const configResolved = plugin.configResolved as unknown as (config: {
      root: string;
      env: Record<string, string>;
    }) => void;
    configResolved({
      root: path.resolve('.'),
      env: { VITE_SUPABASE_URL: STAGING_URL },
    });

    const emitFile = vi.fn();
    const generateBundle = plugin.generateBundle as unknown as (this: {
      emitFile: typeof emitFile;
    }) => void;
    generateBundle.call({ emitFile });

    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: '_headers',
      source: renderHeaders(template, STAGING_URL),
    });
  });
});

describe('index.html', () => {
  it('carries no inline script, so script-src can stay self', () => {
    const html = readFileSync(path.resolve('index.html'), 'utf8');
    const scripts = [
      ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes = '', body = ''] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body.trim()).toBe('');
    }
    expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>/);
  });
});
