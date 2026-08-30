import { ro } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const BUCHAREST_TIME_ZONE = 'Europe/Bucharest';

type Instant = Date | string;

function validDate(value: Instant): Date | null {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInstant(value: Instant, pattern: string): string | null {
  const date = validDate(value);
  if (!date) return null;

  return formatInTimeZone(date, BUCHAREST_TIME_ZONE, pattern, { locale: ro });
}

/** Stable grouping key for an instant's calendar day in Romania. */
export function bucharestDayKey(value: Instant): string | null {
  return formatInstant(value, 'yyyy-MM-dd');
}

/** `duminică, 30 august 2026`, regardless of the device's own timezone. */
export function formatBucharestDay(value: Instant): string {
  return formatInstant(value, 'EEEE, d MMMM yyyy') ?? '—';
}

/** `00:30`, always interpreted in Europe/Bucharest. */
export function formatBucharestTime(value: Instant): string {
  return formatInstant(value, 'HH:mm') ?? '—';
}

/**
 * Convert the value from an `<input type="datetime-local">` into a database
 * instant. A round-trip check rejects the missing hour during spring DST.
 */
export function bucharestWallTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;

  const instant = fromZonedTime(value, BUCHAREST_TIME_ZONE);
  if (Number.isNaN(instant.getTime())) return null;

  const roundTrip = formatInTimeZone(
    instant,
    BUCHAREST_TIME_ZONE,
    "yyyy-MM-dd'T'HH:mm",
  );
  return roundTrip === value ? instant.toISOString() : null;
}

/** Convert a stored instant back to a `datetime-local` form value. */
export function isoToBucharestWallTime(value: string): string {
  return formatInstant(value, "yyyy-MM-dd'T'HH:mm") ?? '';
}
