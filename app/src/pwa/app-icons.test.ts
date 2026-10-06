import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  APPLE_TOUCH_ICON,
  FAVICONS,
  MANIFEST_ICONS,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
} from './app-icons';
import { createPwaOptions } from './pwa-config';

const PUBLIC = path.resolve('public');
const fromPublic = (href: string) => path.join(PUBLIC, href.replace(/^\//, ''));

type Png = {
  width: number;
  height: number;
  colourType: number;
  /** RGBA, whatever the stored colour type. */
  pixel: (x: number, y: number) => [number, number, number, number];
};

/** Enough PNG to check our generated files: 8-bit RGB or RGBA, no interlace. */
function readPng(href: string): Png {
  const file = readFileSync(fromPublic(href));
  expect(file.subarray(1, 4).toString('latin1')).toBe('PNG');
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const bitDepth = file[24];
  const colourType = file[25] ?? -1;
  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colourType);
  expect(file[28]).toBe(0); // not interlaced

  const idat: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') idat.push(file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = raw[y * (stride + 1) + 1 + i] ?? 0;
      const left = i >= channels ? (pixels[y * stride + i - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft =
        y > 0 && i >= channels
          ? (pixels[(y - 1) * stride + i - channels] ?? 0)
          : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        return pb <= pc ? up : upLeft;
      };
      const predictor = [
        0,
        left,
        up,
        (left + up) >> 1,
        filter === 4 ? paeth() : 0,
      ][filter ?? 0];
      pixels[y * stride + i] = (value + (predictor ?? 0)) & 0xff;
    }
  }
  return {
    width,
    height,
    colourType,
    pixel: (x, y) => {
      const at = y * stride + x * channels;
      return [
        pixels[at] ?? 0,
        pixels[at + 1] ?? 0,
        pixels[at + 2] ?? 0,
        channels === 4 ? (pixels[at + 3] ?? 0) : 255,
      ];
    },
  };
}

const squareSize = (sizes: string) => {
  const [w, h] = sizes.split('x').map(Number);
  expect(w).toBe(h);
  return w ?? 0;
};

const BACKGROUND = [0x0c, 0x0d, 0x0c];

describe('app icon files', () => {
  it('every icon the app names exists in public/', () => {
    const named = [
      ...FAVICONS.map(({ href }) => href),
      APPLE_TOUCH_ICON,
      ...MANIFEST_ICONS.map(({ src }) => src),
      NOTIFICATION_ICON,
      NOTIFICATION_BADGE,
    ];
    for (const href of named)
      expect(existsSync(fromPublic(href)), href).toBe(true);
  });

  it('index.html links the favicons and the apple-touch-icon from app-icons.ts', () => {
    const html = new DOMParser().parseFromString(
      readFileSync(path.resolve('index.html'), 'utf8'),
      'text/html',
    );
    const links = (rel: string) =>
      Array.from(html.querySelectorAll(`link[rel="${rel}"]`), (link) => ({
        href: link.getAttribute('href'),
        type: link.getAttribute('type'),
        sizes: link.getAttribute('sizes'),
      }));

    expect(links('icon')).toEqual(FAVICONS.map((icon) => ({ ...icon })));
    expect(links('apple-touch-icon').map(({ href }) => href)).toEqual([
      APPLE_TOUCH_ICON,
    ]);
    for (const { href } of [...links('icon'), ...links('apple-touch-icon')])
      expect(existsSync(fromPublic(href ?? '')), href ?? '').toBe(true);
  });

  it('the manifest carries separate any and maskable icons at 192 and 512', () => {
    const { manifest } = createPwaOptions();
    expect(manifest.icons).toEqual([...MANIFEST_ICONS]);
    for (const purpose of ['any', 'maskable'])
      expect(
        manifest.icons
          .filter((icon) => icon.purpose === purpose)
          .map(({ sizes }) => sizes),
      ).toEqual(['192x192', '512x512']);
  });

  it('each PNG is the size it claims', () => {
    const claims = [
      ...FAVICONS.filter(({ type }) => type === 'image/png').map(
        ({ href, sizes }) => [href, squareSize(sizes)] as const,
      ),
      ...MANIFEST_ICONS.map(
        ({ src, sizes }) => [src, squareSize(sizes)] as const,
      ),
      [APPLE_TOUCH_ICON, 180] as const,
      [NOTIFICATION_BADGE, 96] as const,
    ];
    for (const [href, size] of claims) {
      const png = readPng(href);
      expect([png.width, png.height], href).toEqual([size, size]);
    }
  });

  it('the apple-touch-icon and the maskable icons are opaque', () => {
    for (const href of [
      APPLE_TOUCH_ICON,
      ...MANIFEST_ICONS.filter(({ purpose }) => purpose === 'maskable').map(
        ({ src }) => src,
      ),
    ])
      expect(readPng(href).colourType, href).toBe(2); // RGB: no alpha channel
  });

  it('the maskable icons keep the mark inside the 80% safe-zone circle', () => {
    for (const { src } of MANIFEST_ICONS.filter(
      ({ purpose }) => purpose === 'maskable',
    )) {
      const png = readPng(src);
      const centre = png.width / 2;
      const radius = 0.4 * png.width;
      let outside = 0;
      let inside = 0;
      for (let y = 0; y < png.height; y += 1)
        for (let x = 0; x < png.width; x += 1) {
          const isBackground = png
            .pixel(x, y)
            .slice(0, 3)
            .every((v, k) => v === BACKGROUND[k]);
          const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
          if (distance > radius && !isBackground) outside += 1;
          if (distance <= radius && !isBackground) inside += 1;
        }
      expect(outside, src).toBe(0);
      expect(inside, src).toBeGreaterThan(0);
    }
  });

  it('the notification badge is a white silhouette on transparency', () => {
    const png = readPng(NOTIFICATION_BADGE);
    expect(png.colourType).toBe(6);
    let drawn = 0;
    for (let y = 0; y < png.height; y += 1)
      for (let x = 0; x < png.width; x += 1) {
        const [r, g, b, a] = png.pixel(x, y);
        if (a === 0) continue;
        drawn += 1;
        expect([r, g, b], `${x},${y}`).toEqual([255, 255, 255]);
      }
    expect(png.pixel(0, 0)[3]).toBe(0);
    expect(drawn).toBeGreaterThan(png.width * png.height * 0.1);
  });

  it('the service worker shows pushes with the app icon and the badge', () => {
    const sw = readFileSync(path.resolve('src/pwa/sw.ts'), 'utf8');
    expect(sw).toMatch(/\bicon: NOTIFICATION_ICON,/);
    expect(sw).toMatch(/\bbadge: NOTIFICATION_BADGE,/);
  });

  it('the service worker precaches the icons outside the manifest', () => {
    expect(createPwaOptions().includeAssets).toEqual([
      'favicon.svg',
      'favicon-32x32.png',
      'favicon-16x16.png',
      'apple-touch-icon.png',
      'badge-96.png',
    ]);
  });
});
