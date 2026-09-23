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
