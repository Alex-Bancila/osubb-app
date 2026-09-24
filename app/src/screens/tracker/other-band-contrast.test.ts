import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Alte oportunități OSUBB is greyed by surface, not by opacity: its cards sit
 * on `bg-muted` (`--surface-3`) and keep `text-foreground` (`--text`) and
 * `text-muted-foreground` (`--text-muted`). jsdom computes no colours, so the
 * WCAG AA ratio (4.5:1 for body text) is checked here against the tokens
 * themselves, in both themes.
 */
const css = readFileSync(path.resolve('src/theme/tokens.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(scope: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(scope);
  const value = match?.[1]?.trim();
  if (!value) throw new Error(`--${name} missing`);
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  return alias?.[1] ? token(scope, alias[1]) : value;
}

function channel(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('the greyed Other OSUBB band keeps AA text contrast', () => {
  const light = block(':root');
  const dark = block(':root[data-theme="dark"]');
  it.each([
    ['light', light],
    ['dark', dark],
  ])('%s theme: body and muted text on the muted surface', (_, scope) => {
    const surface = token(scope, 'surface-3');
    expect(contrast(token(scope, 'text'), surface)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token(scope, 'text-muted'), surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
