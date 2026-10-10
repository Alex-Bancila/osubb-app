/** The colour an avatar falls back to: the OSUBB red. */
export const AVATAR_FALLBACK = 'var(--brand-red)';

/**
 * A stored colour, used only when it is exactly `#rrggbb`; otherwise
 * `fallback`. `profiles.avatar_color` is text each Member may write
 * themselves, so a value such as `url(https://…)` must never reach a style
 * (finding F1 of the 2026-09-27 security audit). Callers also set `backgroundColor`, never the
 * `background` shorthand, which would accept an image.
 */
export function safeHexColor(
  value: string | null | undefined,
  fallback: string = AVATAR_FALLBACK,
): string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value
    : fallback;
}

/** A named colour of the OSUBB Brand Book, as a picker offers it. */
export type NamedColor = { name: string; color: string };

/**
 * The Brand Book's colours (the red and the department accents, with the
 * near-black), in the order a colour picker shows them.
 */
export const OSUBB_COLORS: readonly NamedColor[] = [
  { name: 'Roșu OSUBB', color: '#ED2025' },
  { name: 'Educațional', color: '#284C93' },
  { name: 'Financiar', color: '#007F33' },
  { name: 'Resurse Umane', color: '#F2A700' },
  { name: 'Imagine & PR', color: '#7500A0' },
  { name: 'Tineret', color: '#FF3B3B' },
  { name: 'Negru', color: '#0B0B0C' },
];

export type Hsv = { h: number; s: number; v: number };

/** `#RRGGBB` → hue 0–360, saturation and value 0–1; `null` when not a hex. */
export function hexToHsv(hex: string): Hsv | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Hue 0–360, saturation and value 0–1 → `#RRGGBB` (upper case). */
export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`.toUpperCase();
}
