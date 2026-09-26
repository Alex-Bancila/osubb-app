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

/**
 * A count of Tasks with the Romanian plural: "1 task", "3 taskuri",
 * "20 de taskuri" — the "de" appears when the last two digits are 0 or 20+,
 * for any count above 19.
 */
export function formatTaskCount(count: number): string {
  if (count === 1) return '1 task';
  const lastTwo = count % 100;
  const de = count >= 20 && (lastTwo === 0 || lastTwo >= 20);
  return `${new Intl.NumberFormat('ro-RO').format(count)} ${de ? 'de ' : ''}taskuri`;
}

/** Parse a PostgreSQL `date` as a local calendar date, never as a UTC instant. */
export function parseLocalDate(value: string | null): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  date.setFullYear(year);

  return year > 0 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

/** `12 mar.` — short, because task lists are scanned, not read. */
export function formatDate(iso: string | null): string {
  const date = parseLocalDate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/** `miercuri, 26 august 2026` — long form, for the one date a screen leads with. */
export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * `Ioana` from `Ioana Popescu`.
 *
 * The app greets a person, not a row — and a Romanian first name is the first
 * word here, unlike the surname-first order some registries use.
 */
export function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/** Two letters for an avatar, from a name if we have one, else an address. */
export function initials(nameOrEmail: string | undefined | null): string {
  if (!nameOrEmail) return '?';
  const parts = nameOrEmail.trim().split(/\s+/);
  const first = parts[0]?.[0];
  const second = parts[1]?.[0];
  if (first && second && !nameOrEmail.includes('@')) {
    return (first + second).toUpperCase();
  }
  return nameOrEmail.slice(0, 2).toUpperCase();
}

/** `12 martie 2024` — day, month and year, for a date that is a milestone. */
export function formatDayMonthYear(iso: string | null): string | null {
  const date = parseLocalDate(iso);
  if (!date) return null;
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
