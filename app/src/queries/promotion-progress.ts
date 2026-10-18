import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fetchEvaluationSettings } from './evaluation-settings';
import { keys } from './keys';

/**
 * #634, #828 — what Profil needs to show a Member where they stand (ADR-0004;
 * rulings R9, R13, R18, R28, R58).
 *
 * Everything here is read, never computed: the Membership Cutoff Date a
 * Voluntar must have joined by to be listed (R58, in place of the months of
 * tenure the Promotion Rules demanded) and, from
 * `my_role_evaluation_standing(kind)` (#826), the caller's own Task Points in
 * the current window and that kind's Promotion Threshold in force. There is no
 * open Evaluation Period any more (R28): a Role Evaluation is a run BC
 * performs over a range it chooses, and reaching the threshold makes a
 * Promotion Candidate — BC decides, nothing is granted automatically.
 *
 * The kind follows the Role: Recrut, Voluntar and Voluntar Activ read the
 * Voluntar Activ kind; a Voluntar cu Drept de Vot reads the Adunarea
 * Generală kind. The read returns only the caller's own numbers: no rank, no
 * other Member's points (ruling R6).
 */
export type RoleEvaluationKind = 'voluntar_activ' | 'adunarea_generala';

/** The Role Evaluation kind whose standing a Role reads (R28). */
export function roleEvaluationKindFor(role: string): RoleEvaluationKind {
  return role === 'vot' ? 'adunarea_generala' : 'voluntar_activ';
}

export type PromotionProgress = {
  /**
   * The Membership Cutoff Date in force (Data limită de intrare, R58): the day
   * a Voluntar must have joined by to be listed as a Promotion Candidate.
   * Null until BC sets it; nobody is listed meanwhile.
   */
  membershipCutoff: string | null;
  /** The kind's Promotion Threshold in force; null while unset. */
  threshold: number | null;
  /**
   * The first day the standing counts from (ruling 17 of R58): the later of
   * the day after the kind's last Role Evaluation's range and the Points Start
   * Date; null when neither exists.
   */
  since: string | null;
  /** My net Task Points since then (from the beginning when `since` is null). */
  points: number;
};

/**
 * Whether a Member joined by the Membership Cutoff Date (R58). `met` is
 * `joinedAt <= cutoff` — the cutoff day itself counts, as the server's own
 * comparison does — and false while there is no cutoff or no join date: with
 * no cutoff nobody is listed, and a Member without a join date cannot be
 * shown to have joined by any day. Two ISO days compare correctly as strings.
 */
export type Tenure = {
  cutoff: string | null;
  joinedAt: string | null;
  met: boolean;
};

export function tenureState(
  joinedAt: string | null,
  cutoff: string | null,
): Tenure {
  return {
    cutoff,
    joinedAt,
    met: joinedAt !== null && cutoff !== null && joinedAt <= cutoff,
  };
}

export async function fetchPromotionProgress(
  kind: RoleEvaluationKind,
): Promise<PromotionProgress> {
  const [settings, standingRes] = await Promise.all([
    fetchEvaluationSettings(),
    supabase.rpc('my_role_evaluation_standing', { p_kind: kind }).maybeSingle(),
  ]);
  if (standingRes.error) throw standingRes.error;

  const standing = standingRes.data;
  return {
    membershipCutoff: settings.membershipCutoff,
    // The generated types say non-null; the SQL returns null while unset.
    threshold: (standing?.threshold as number | null | undefined) ?? null,
    since: (standing?.since as string | null | undefined) ?? null,
    points: standing?.task_points ?? 0,
  };
}

export function usePromotionProgress({
  role,
  enabled = true,
}: {
  role: string | undefined;
  enabled?: boolean;
}) {
  const id = useAuth().session?.user.id;
  const kind = roleEvaluationKindFor(role ?? '');
  return useQuery({
    queryKey: keys.points.promotionProgress(id, kind),
    queryFn: id && enabled ? () => fetchPromotionProgress(kind) : skipToken,
  });
}
