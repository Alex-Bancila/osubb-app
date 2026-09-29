import { formatDayMonthYear, parseLocalDate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useMyProfile } from '../../queries/profile';
import {
  usePromotionProgress,
  type PromotionProgress as Progress,
} from '../../queries/promotion-progress';
import { useRoles } from '../../queries/reference';

/**
 * What Profil's Promovare panel shows (#634), decided before the page renders
 * its grid (#824): `hidden` means the panel does not exist; otherwise it is
 * loading, failed, or one of the views below. See `PromotionProgress.tsx`
 * for the six states.
 */
export type PromotionState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'view'; view: NonNullable<View> };

export function usePromotionProgressState(): PromotionState {
  const { claims } = useAuth();
  const profile = useMyProfile().data;
  const roles = useRoles().data;

  const role = profile?.role ?? claims?.member_role;
  const level =
    claims?.member_level ?? (role ? roles?.get(role)?.level : undefined);
  const onLadder =
    role !== undefined &&
    LADDER_ROLES.has(role) &&
    level !== undefined &&
    level < 5;

  const progress = usePromotionProgress({ role, enabled: onLadder });

  if (!onLadder || !role) return { kind: 'hidden' };
  if (progress.isError) {
    return {
      kind: 'error',
      error: progress.error,
      retry: () => void progress.refetch(),
    };
  }
  if (!progress.data) {
    return progress.isPending ? { kind: 'loading' } : { kind: 'hidden' };
  }

  const view = viewFor(role, profile?.joined_at ?? null, progress.data);
  return view ? { kind: 'view', view } : { kind: 'hidden' };
}

const LADDER_ROLES = new Set(['recrut', 'voluntar', 'activ', 'vot']);

/**
 * `since` is the first day the points count from, formatted ('1 iulie
 * 2026'): the day AFTER the last Role Evaluation's range, never the
 * evaluation's own date (F-6, #893). Null before any Role Evaluation: then
 * `points` is the Member's total, and the panel says it once rather than as
 * a second 'total' (#859 B38).
 *
 * `startsLater`: `since` is still ahead (a Role Evaluation whose range ended
 * today), so nothing counts yet; the panel says when the count starts
 * rather than showing 0 as a result.
 */
export type View =
  | { kind: 'tenure'; text: string }
  | {
      kind: 'bar';
      points: number;
      threshold: number;
      since: string | null;
      startsLater?: boolean;
    }
  | {
      kind: 'reference';
      points: number;
      threshold: number;
      since: string | null;
      startsLater?: boolean;
    }
  | null;

/** The line a Recrut reads once the tenure date has passed (#859 B43). */
export const TENURE_MET_TEXT =
  'Îndeplinești vechimea; promovarea se aplică la următoarea rulare.';

function viewFor(
  role: string,
  joinedAt: string | null,
  progress: Progress,
): View {
  const { threshold, points, since } = progress;
  // The bar needs a target; without one it is hidden, never faked.
  const measurable = threshold !== null;
  const sinceDate = since ? (formatDayMonthYear(since) ?? since) : null;
  const sinceDay = parseLocalDate(since);
  const startsLater = sinceDay !== null && sinceDay > startOfToday();

  if (role === 'recrut') {
    const date = tenureDate(joinedAt, progress.voluntarTenureMonths);
    if (!date) return null;
    // The tenure job promotes on its next run, so a date already reached is
    // never promised in the future tense (Audit D D-7).
    return startOfToday() >= date
      ? { kind: 'tenure', text: TENURE_MET_TEXT }
      : { kind: 'tenure', text: `Devii Voluntar din ${formatTenure(date)}` };
  }

  if (role === 'voluntar') {
    const date = tenureDate(joinedAt, progress.activTenureMonths);
    if (!date) return null;
    if (measurable && startOfToday() >= date) {
      return { kind: 'bar', points, threshold, since: sinceDate, startsLater };
    }
    return {
      kind: 'tenure',
      text: `Poți deveni Voluntar Activ din ${formatTenure(date)}`,
    };
  }

  // Voluntar Activ and Voluntar cu Drept de Vot: no tenure line to fall back on.
  return measurable
    ? {
        kind: 'reference',
        points,
        threshold,
        since: sinceDate,
        startsLater,
      }
    : null;
}

/**
 * `joined_at` + the rule's months, as a local calendar date. A day the target
 * month lacks clamps to its last day (31 August + 6 months is 28/29 February),
 * the way PostgreSQL's `date + interval 'n months'` does.
 */
function tenureDate(joinedAt: string | null, months: number | null) {
  const joined = parseLocalDate(joinedAt);
  if (!joined || months === null) return null;
  const year = joined.getFullYear();
  const month = joined.getMonth() + months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(joined.getDate(), lastDay));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatTenure(date: Date): string {
  const iso = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return formatDayMonthYear(iso) ?? iso;
}
