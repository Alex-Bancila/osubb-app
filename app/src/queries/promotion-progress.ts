import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * #634, #828 — what Profil needs to show a Member where they stand (ADR-0004;
 * rulings R9, R13, R18, R28).
 *
 * Everything here is read, never computed: the tenure each Promotion Rule
 * demands (#49) and, from `my_role_evaluation_standing(kind)` (#826), the
 * caller's own Task Points since the last Role Evaluation of their kind and
 * that kind's Promotion Threshold in force. There is no open Evaluation
 * Period any more (R28): a Role Evaluation is a run BC performs over a range
 * it chooses, and reaching the threshold makes a Promotion Candidate at the
 * next one — BC decides, nothing is granted automatically.
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
  /** Months of tenure the enabled Recrut → Voluntar (`time`) rule demands. */
  voluntarTenureMonths: number | null;
  /** Months of tenure the enabled Voluntar → Voluntar Activ (`top_percent`) rule demands. */
  activTenureMonths: number | null;
  /** The kind's Promotion Threshold in force; null while unset. */
  threshold: number | null;
  /** The day after the kind's last Role Evaluation's range; null before any. */
  since: string | null;
  /** My net Task Points since then (all time before any Role Evaluation). */
  points: number;
};

export async function fetchPromotionProgress(
  kind: RoleEvaluationKind,
): Promise<PromotionProgress> {
  const [rulesRes, standingRes] = await Promise.all([
    supabase
      .from('promotion_rules')
      .select('from_role, to_role, kind, min_tenure_months, enabled'),
    supabase.rpc('my_role_evaluation_standing', { p_kind: kind }).maybeSingle(),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (standingRes.error) throw standingRes.error;

  // A disabled rule promotes nobody, so it promises no date.
  const tenure = (ruleKind: string, from: string, to: string) =>
    rulesRes.data.find(
      (rule) =>
        rule.enabled &&
        rule.kind === ruleKind &&
        rule.from_role === from &&
        rule.to_role === to,
    )?.min_tenure_months ?? null;

  const standing = standingRes.data;
  return {
    voluntarTenureMonths: tenure('time', 'recrut', 'voluntar'),
    activTenureMonths: tenure('top_percent', 'voluntar', 'activ'),
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
