/**
 * Dates, points and initials — in Romanian, the way a member reads them.
 *
 * Formatting lives here rather than in screens so a number looks the same
 * everywhere it appears, which is what makes a total on the dashboard and the
 * same total in the directory recognisable as one number.
 */

/**
 * Points, with a real minus sign.
 *
 * A sanction is deliberately visible in this app (the mandate asks for it), so
 * a negative total has to look intentional rather than like a stray hyphen:
 * `−6`, U+2212, not `-6`.
 */
export function formatPoints(points: number): string {
  const formatted = new Intl.NumberFormat('ro-RO').format(Math.abs(points));
  return points < 0 ? `−${formatted}` : formatted;
}

/** `12 mar.` — short, because task lists are scanned, not read. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** Two letters for an avatar, from a name if we have one, else an address. */
export function initials(nameOrEmail: string | undefined | null): string {
  if (!nameOrEmail) return '?';
  const parts = nameOrEmail.trim().split(/\s+/);
  if (parts.length >= 2 && !nameOrEmail.includes('@')) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return nameOrEmail.slice(0, 2).toUpperCase();
}
