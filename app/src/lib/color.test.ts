import { describe, expect, it } from 'vitest';
import { AVATAR_FALLBACK, safeHexColor } from './color';

describe('safeHexColor', () => {
  it('keeps a stored #rrggbb colour', () => {
    expect(safeHexColor('#ED2025')).toBe('#ED2025');
    expect(safeHexColor('#0a1b2c')).toBe('#0a1b2c');
  });

  it.each([
    null,
    undefined,
    '',
    'red',
    '#fff',
    '#ED2025 ',
    '#ED202599',
    'url(https://attacker.example/p.gif)',
    'linear-gradient(red, blue)',
    '#ED2025;background:url(x)',
    'var(--brand-red)',
  ])('falls back for %j', (value) => {
    expect(safeHexColor(value)).toBe(AVATAR_FALLBACK);
    expect(safeHexColor(value, 'var(--ink-700)')).toBe('var(--ink-700)');
  });
});
