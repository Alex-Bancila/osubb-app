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
