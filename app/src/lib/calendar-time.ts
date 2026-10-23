import { fromZonedTime } from 'date-fns-tz';

export const BUCHAREST_TIME_ZONE = 'Europe/Bucharest';

type Instant = Date | string;

const wallFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function validDate(value: Instant): Date | null {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format the instant in Bucharest without passing through the device's wall time. */
function wallValue(date: Date): string {
  const parts = new Map(
    wallFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}`;
}

/** Stable grouping key for an instant's calendar day in Romania. */
export function bucharestDayKey(value: Instant): string | null {
  const date = validDate(value);
  return date ? wallValue(date).slice(0, 10) : null;
}

/** `duminică, 30 august 2026`, regardless of the device's own timezone. */
export function formatBucharestDay(value: Instant): string {
  const date = validDate(value);
  return date ? dayFormatter.format(date) : '—';
}

/** `00:30`, always interpreted in Europe/Bucharest. */
export function formatBucharestTime(value: Instant): string {
  const date = validDate(value);
  return date ? wallValue(date).slice(11) : '—';
}

const shortDayFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const shortDayWithYearFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * `mie., 14 oct.` — the day as a card shows it: scanned, not read. The year
 * is said only when it is not this one (`mie., 14 oct. 2027`).
 */
export function formatBucharestShortDay(
  value: Instant,
  now: Instant = new Date(),
): string {
  const date = validDate(value);
  if (!date) return '—';
  const today = validDate(now);
  const sameYear =
    today !== null &&
    wallValue(date).slice(0, 4) === wallValue(today).slice(0, 4);
  return (sameYear ? shortDayFormatter : shortDayWithYearFormatter).format(
    date,
  );
}

/**
 * `mie., 14 oct. · 23:59` — the one short form for a day and its time on
 * every card. Always Romania's time; a form says so where a time is typed.
 */
export function formatBucharestShort(
  value: Instant,
  now: Instant = new Date(),
): string {
  const date = validDate(value);
  if (!date) return '—';
  return `${formatBucharestShortDay(date, now)} · ${formatBucharestTime(date)}`;
}

/**
 * Convert the value from an `<input type="datetime-local">` into a database
 * instant. The Bucharest round-trip rejects the missing hour during spring DST.
 */
export function bucharestWallTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;

  const instant = fromZonedTime(value, BUCHAREST_TIME_ZONE);
  if (Number.isNaN(instant.getTime())) return null;

  return wallValue(instant) === value ? instant.toISOString() : null;
}

/** Convert a stored instant back to a `datetime-local` form value. */
export function isoToBucharestWallTime(value: string): string {
  const date = validDate(value);
  return date ? wallValue(date) : '';
}

/**
 * The last Bucharest day an Event touches (#1098, R63). An end at a midnight
 * is the end of the day before (an all-day Event's exclusive end, or a party
 * until 00:00), and an end before the day of the start is the start's.
 */
export function bucharestLastDayKey(
  dayKey: string,
  endsAt: Instant | null,
): string {
  if (!endsAt) return dayKey;
  const end = validDate(endsAt);
  if (!end) return dayKey;
  const last = bucharestDayKey(new Date(end.getTime() - 1));
  return last && last > dayKey ? last : dayKey;
}
