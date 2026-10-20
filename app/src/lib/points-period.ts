import { formatDayOrNull } from './format';
import type { WorkFilterValue } from './work-filter';

/**
 * The words a total uses for where it begins and what period it covers (R58),
 * apart from `queries/evaluation-settings` so that nothing here loads the
 * Supabase client: the screens and their tests import these, and the hook
 * that reads the Points Start Date from the query module.
 */

/** What a total says about where it begins: `din 01.09.2026`, or nothing. */
export function pointsSinceText(
  date: string | null | undefined,
): string | null {
  const day = formatDayOrNull(date);
  return day ? `din ${day}` : null;
}

/**
 * The period a total counts over, in the words both captions share (the
 * Cup's `puncte acordate …` and Tracker membru's `acordate …`), for the Work
 * Filter's range and the Points Start Date (R58). Every day is written
 * dd.mm.yyyy, as the settings are everywhere else:
 *
 * - an explicit **De la** — even one before the start date, the lookback — is
 *   the range it is: `între 01.08.2026 și 30.09.2026`, `din 01.08.2026`;
 * - without one the server counts from the start date, so the text begins
 *   there: `din 01.09.2026`, `din 01.09.2026 până la 30.09.2026`;
 * - `null` when nothing narrows the period (the whole record), and
 *   `undefined` while the start date is not known (loading, or a failed
 *   read): a caption must then say nothing about the period rather than
 *   claim the whole record. A day the member chose stays in the words even
 *   then: `până la 30.09.2026`.
 */
export function pointsPeriodText(
  range: Pick<WorkFilterValue, 'from' | 'to'>,
  pointsStartDate: string | null | undefined,
): string | null | undefined {
  const from = range.from && formatDayOrNull(range.from);
  const to = range.to && formatDayOrNull(range.to);
  if (from && to) return `între ${from} și ${to}`;
  if (!from && pointsStartDate === undefined)
    return to ? `până la ${to}` : undefined;
  const begin = from ? `din ${from}` : pointsSinceText(pointsStartDate);
  return [begin, to && `până la ${to}`].filter(Boolean).join(' ') || null;
}
