#!/usr/bin/env node
/**
 * Regenerates the app icons in app/public from the vector source PDF.
 *
 *   npm --prefix scripts/app-icon ci
 *   node scripts/app-icon/generate.mjs "/path/to/sticker.pdf"
 *
 * The PDF (Alex's Illustrator export, ~48 MB of private Illustrator data
 * around six vector paths) is never committed. This script reads its single
 * page, lifts the background square and the six arcs out as vector paths,
 * writes them as an SVG master (docs/brand/osubb-app-icon.svg), and draws
 * every PNG from those paths at its exact size, so nothing is a downscaled
 * bitmap. It refuses a PDF whose colours are not the brand's three.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PNG } from 'pngjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const PUBLIC = path.join(ROOT, 'app/public');
const MASTER_SVG = path.join(ROOT, 'docs/brand/osubb-app-icon.svg');

/* docs/brand/reference.md: the mark is never recoloured. */
const BACKGROUND = '#0c0d0c';
const ART_COLOURS = new Set(['#ffffff', '#ff3017']);
/* The maskable safe zone: a circle of radius 40% of the icon, centred. */
const MASKABLE_SAFE_RADIUS = 0.4;

/**
 * Every generated file. `art` is the mark's diameter as a share of the icon;
 * omitted, the PDF's own composition is kept (the mark covers ~69%).
 * `shape`: `square` is the full-bleed square, `rounded` the square with
 * rounded corners on transparency (desktop launchers draw it as-is), `none`
 * the mark alone. `mono` paints every arc white, for Android's status bar.
 */
const TARGETS = [
  {
    file: 'favicon-16x16.png',
    size: 16,
    shape: 'rounded',
    radius: 0.16,
    art: 0.84,
  },
  {
    file: 'favicon-32x32.png',
    size: 32,
    shape: 'rounded',
    radius: 0.16,
    art: 0.84,
  },
  { file: 'apple-touch-icon.png', size: 180, shape: 'square' },
  { file: 'icon-192.png', size: 192, shape: 'rounded', radius: 0.18 },
  { file: 'icon-512.png', size: 512, shape: 'rounded', radius: 0.18 },
  { file: 'icon-maskable-192.png', size: 192, shape: 'square' },
  { file: 'icon-maskable-512.png', size: 512, shape: 'square' },
  { file: 'badge-96.png', size: 96, shape: 'none', art: 0.9, mono: true },
];
const FAVICON_SVG = { file: 'favicon.svg', radius: 0.16, art: 0.84 };

const hex = (rgb) =>
  '#' +
  Array.from(rgb, (v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Affine matrices as PDF writes them: [a b c d e f]. `then(a, b)` = a, then b. */
const apply = (m, x, y) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const then = (a, b) => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

async function readArtwork(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  if (doc.numPages !== 1)
    throw new Error(`expected one page, found ${doc.numPages}`);
  const page = await doc.getPage(1);
  const [vx0, vy0, vx1, vy1] = page.view;
  const width = vx1 - vx0;
  const height = vy1 - vy0;
  if (Math.abs(width - height) > 1e-3)
    throw new Error(`page is not square: ${width} x ${height}`);

  const OPS = pdfjs.OPS;
  const { fnArray, argsArray } = await page.getOperatorList();
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let fill = '#000000';
  let pending = null;
  const shapes = [];

  /* y grows downwards in the SVG and on the canvas. */
  const point = (x, y) => {
    const [px, py] = apply(ctm, x, y);
    return [px - vx0, vy1 - py];
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = then(args, ctm);
    else if (fn === OPS.setFillRGBColor) fill = hex(Object.values(args));
    else if (fn === OPS.constructPath) {
      /* pdfjs 4.x: [ops, coords, minMax]; pinned in package.json. */
      const [ops, coords] = args;
      const segments = [];
      let c = 0;
      let current = [0, 0];
      const take = (n) => {
        const out = [];
        for (let k = 0; k < n; k += 1)
          out.push(point(coords[c + 2 * k], coords[c + 2 * k + 1]));
        c += 2 * n;
        return out;
      };
      for (const op of ops) {
        if (op === OPS.moveTo) {
          const [p] = take(1);
          segments.push({ cmd: 'M', pts: [p] });
          current = p;
        } else if (op === OPS.lineTo) {
          const [p] = take(1);
          segments.push({ cmd: 'L', pts: [p], from: current });
          current = p;
        } else if (op === OPS.curveTo) {
          const pts = take(3);
          segments.push({ cmd: 'C', pts, from: current });
          current = pts[2];
        } else if (op === OPS.curveTo2) {
          /* v: the first control point is the current point. */
          const [c2, end] = take(2);
          segments.push({ cmd: 'C', pts: [current, c2, end], from: current });
          current = end;
        } else if (op === OPS.curveTo3) {
          /* y: the second control point is the end point. */
          const [c1, end] = take(2);
          segments.push({ cmd: 'C', pts: [c1, end, end], from: current });
          current = end;
        } else if (op === OPS.closePath) {
          segments.push({ cmd: 'Z', pts: [] });
        } else if (op === OPS.rectangle) {
          const [x, y, w, h] = coords.slice(c, c + 4);
          c += 4;
          const corners = [
            point(x, y),
            point(x + w, y),
            point(x + w, y + h),
            point(x, y + h),
          ];
          segments.push({ cmd: 'M', pts: [corners[0]] });
          for (const p of corners.slice(1))
            segments.push({ cmd: 'L', pts: [p] });
          segments.push({ cmd: 'Z', pts: [] });
        } else {
          throw new Error(`unsupported path operator ${op}`);
        }
      }
      pending = segments;
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      if (!pending) throw new Error('fill without a path');
      shapes.push({
        fill,
        segments: pending,
        rule: fn === OPS.eoFill ? 'evenodd' : 'nonzero',
      });
      pending = null;
    } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
      /* The only clip is the page rectangle; the path is consumed here. */
      if (fn === OPS.endPath) pending = null;
    } else if (
      fn === OPS.stroke ||
      fn === OPS.fillStroke ||
      fn === OPS.paintImageXObject ||
      fn === OPS.showText ||
      fn === OPS.shadingFill
    ) {
      throw new Error(
        `the source holds more than filled paths (operator ${fn})`,
      );
    }
  }

  const [background, ...art] = shapes;
  const bgIsPage =
    background &&
    background.segments.length === 5 &&
    background.segments
      .filter((s) => s.pts.length)
      .every((s) =>
        s.pts.every(
          ([x, y]) =>
            [0, width].some((v) => Math.abs(v - x) < 1e-3) &&
            [0, height].some((v) => Math.abs(v - y) < 1e-3),
        ),
      );
  if (!bgIsPage || background.fill !== BACKGROUND)
    throw new Error(
      `expected a full-page ${BACKGROUND} square first, found ${background?.fill}`,
    );
  for (const shape of art)
    if (!ART_COLOURS.has(shape.fill))
      throw new Error(
        `unexpected colour ${shape.fill}: the mark is never recoloured`,
      );
  if (art.length === 0) throw new Error('no artwork after the background');

  return { size: width, art };
}

const fmt = (n) => String(Math.round(n * 1000) / 1000);
const pathData = (segments) =>
  segments
    .map(
      ({ cmd, pts }) =>
        cmd + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' '),
    )
    .join('');

/** Samples every curve, for the extent and the safe-zone radius. */
function measure(art, size) {
  const samples = [];
  for (const { segments } of art)
    for (const s of segments) {
      if (s.cmd === 'M' || s.cmd === 'L') samples.push(s.pts[0]);
      if (s.cmd === 'C')
        for (let t = 0; t <= 1; t += 1 / 64) {
          const u = 1 - t;
          const [p0, [p1, p2, p3]] = [s.from, s.pts];
          samples.push(
            [0, 1].map(
              (k) =>
                u * u * u * p0[k] +
                3 * u * u * t * p1[k] +
                3 * u * t * t * p2[k] +
                t * t * t * p3[k],
            ),
          );
        }
    }
  const xs = samples.map(([x]) => x);
  const ys = samples.map(([, y]) => y);
  const box = {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
  const centre = size / 2;
  const radius = Math.max(
    ...samples.map(([x, y]) => Math.hypot(x - centre, y - centre)),
  );
  return {
    box,
    cx: (box.x0 + box.x1) / 2,
    cy: (box.y0 + box.y1) / 2,
    extent: Math.max(box.x1 - box.x0, box.y1 - box.y0),
    safeRadius: radius / size,
  };
}

/** Page units → icon pixels: the PDF's own composition, or the mark at `art`. */
function placement(target, art, geometry) {
  const s = target.size;
  if (target.art === undefined) {
    const k = s / art.size;
    return { k, tx: 0, ty: 0 };
  }
  const k = (target.art * s) / geometry.extent;
  return { k, tx: s / 2 - geometry.cx * k, ty: s / 2 - geometry.cy * k };
}

function render(target, artwork, geometry) {
  const { size } = target;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  if (target.shape === 'square') ctx.fillRect(0, 0, size, size);
  if (target.shape === 'rounded') {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, target.radius * size);
    ctx.fill();
  }
  const { k, tx, ty } = placement(target, artwork, geometry);
  ctx.setTransform(k, 0, 0, k, tx, ty);
  for (const shape of artwork.art) {
    ctx.fillStyle = target.mono ? '#ffffff' : shape.fill;
    ctx.fill(new Path2D(pathData(shape.segments)), shape.rule);
  }

  const { data } = ctx.getImageData(0, 0, size, size);
  const opaque = target.shape === 'square';
  const png = new PNG({
    width: size,
    height: size,
    colorType: opaque ? 2 : 6,
    inputHasAlpha: true,
  });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png, {
    colorType: opaque ? 2 : 6,
    inputHasAlpha: true,
  });
}

function svg(artwork, { radius, art } = {}, geometry) {
  const s = artwork.size;
  const paths = artwork.art
    .map(
      (shape) =>
        `  <path fill="${shape.fill.toUpperCase()}"${shape.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''} d="${pathData(shape.segments)}"/>`,
    )
    .join('\n');
  if (art === undefined)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(s)} ${fmt(s)}">\n  <rect width="${fmt(s)}" height="${fmt(s)}" fill="${BACKGROUND.toUpperCase()}"/>\n${paths}\n</svg>\n`;
  const { k, tx, ty } = placement({ size: s, art }, artwork, geometry);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(s)} ${fmt(s)}">\n  <rect width="${fmt(s)}" height="${fmt(s)}" rx="${fmt(radius * s)}" fill="${BACKGROUND.toUpperCase()}"/>\n  <g transform="matrix(${fmt(k)} 0 0 ${fmt(k)} ${fmt(tx)} ${fmt(ty)})">\n${paths.replace(/^/gm, '  ')}\n  </g>\n</svg>\n`;
}

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('usage: node scripts/app-icon/generate.mjs <source.pdf>');
  process.exit(2);
}

const artwork = await readArtwork(pdfPath);
const geometry = measure(artwork.art, artwork.size);
if (geometry.safeRadius > MASKABLE_SAFE_RADIUS)
  throw new Error(
    `the mark reaches ${(geometry.safeRadius * 100).toFixed(1)}% from the centre, past the maskable safe zone (40%)`,
  );

fs.writeFileSync(MASTER_SVG, svg(artwork));
fs.writeFileSync(
  path.join(PUBLIC, FAVICON_SVG.file),
  svg(artwork, FAVICON_SVG, geometry),
);
for (const target of TARGETS)
  fs.writeFileSync(
    path.join(PUBLIC, target.file),
    render(target, artwork, geometry),
  );

const pct = (v) => `${(v * 100).toFixed(1)}%`;
console.log(
  `source: ${artwork.art.length} arcs on a ${fmt(artwork.size)} pt square`,
);
console.log(
  `mark: ${pct(geometry.extent / artwork.size)} of the square; furthest point ${pct(geometry.safeRadius)} from the centre (maskable limit 40%)`,
);
console.log(
  `wrote ${path.relative(ROOT, MASTER_SVG)}, app/public/${FAVICON_SVG.file}, ${TARGETS.map((t) => `app/public/${t.file}`).join(', ')}`,
);
