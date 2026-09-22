import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

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
