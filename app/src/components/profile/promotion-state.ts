import {
  formatDay,
  formatDayMonthYear,
  parseLocalDate,
} from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useMyProfile } from '../../queries/profile';
import {
  tenureState,
  usePromotionProgress,
  type PromotionProgress as Progress,
  type Tenure,
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
 * 2026'), and `sinceIso` the same day as the server gave it: the later of
 * the day AFTER the last Role Evaluation's range, never the evaluation's own
 * date (F-6, #893), and the Points Start Date (ruling 17, R58). Which of the
 * two opened the window decides what the panel may say it is "after", so the
 * panel compares `sinceIso` with the Points Start Date. Null before any Role
 * Evaluation and any start date: then `points` is the Member's total, and the
 * panel says it once rather than as a second 'total' (#859 B38).
 *
 * `startsLater`: `since` is still ahead (a Role Evaluation whose range ended
 * today), so nothing counts yet; the panel says when the count starts
 * rather than showing 0 as a result.
 *
 * `tenure` (R58): the one line a Voluntar reads in place of the bar, about the
 * Membership Cutoff Date. `text` says it; `tenure` is the state it was made
 * from (the cutoff, the Member's join date, whether they joined by it), so the
 * panel can word it differently without asking again.
 */
export type View =
  | { kind: 'tenure'; text: string; tenure: Tenure }
  | {
      kind: 'bar';
      points: number;
      threshold: number;
      since: string | null;
      sinceIso: string | null;
      startsLater?: boolean;
    }
  | {
      kind: 'reference';
      points: number;
      threshold: number;
      since: string | null;
      sinceIso: string | null;
      startsLater?: boolean;
    }
  | null;

/**
 * What a Voluntar reads about the Membership Cutoff Date (R58): that they
 * joined by it, or the day they must have joined by to be listed. The days are
 * written dd.mm.yyyy, as the settings are everywhere else.
 */
function tenureText({ cutoff, met }: Tenure): string {
  const day = formatDay(cutoff);
  return met
    ? `Ai intrat în OSUBB până la ${day}: poți deveni candidat la Voluntar Activ.`
    : `Pentru a deveni candidat la Voluntar Activ trebuie să fi intrat în OSUBB până la ${day}.`;
}

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

  // R58: nothing promotes a Recrut by the calendar; BC does it by hand in
  // Roluri, so there is no date to show and nothing to promise.
  if (role === 'recrut') return null;

  if (role === 'voluntar') {
    // Without a Membership Cutoff Date nobody is listed, and the panel makes
    // no promise either (as it made none for a disabled rule).
    if (progress.membershipCutoff === null) return null;
    const tenure = tenureState(joinedAt, progress.membershipCutoff);
    if (tenure.met && measurable) {
      return {
        kind: 'bar',
        points,
        threshold,
        since: sinceDate,
        sinceIso: since,
        startsLater,
      };
    }
    return { kind: 'tenure', text: tenureText(tenure), tenure };
  }

  // Voluntar Activ and Voluntar cu Drept de Vot: no tenure line to fall back on.
  return measurable
    ? {
        kind: 'reference',
        points,
        threshold,
        since: sinceDate,
        sinceIso: since,
        startsLater,
      }
    : null;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
