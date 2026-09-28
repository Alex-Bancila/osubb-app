import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * #634 — what the profile needs to show a Member where they stand on the
 * ladder (ADR-0004; rulings R9, R13, R18, R28).
 *
 * Everything here is read, never computed: the tenure each Promotion Rule
 * demands (#49) and, from `my_role_evaluation_standing` (#826), the caller's
 * own Task Points since the last Voluntar Activ Role Evaluation and that
 * kind's Promotion Threshold in force. The read returns only the caller's own
 * numbers: no rank, no other Member's points (ruling R6). #828 reads the kind
 * per Role and rewrites the copy for R28.
 */
export type PromotionProgress = {
  /** Months of tenure the enabled Recrut → Voluntar (`time`) rule demands. */
  voluntarTenureMonths: number | null;
  /** Months of tenure the enabled Voluntar → Voluntar Activ (`top_percent`) rule demands. */
  activTenureMonths: number | null;
  /** The Voluntar Activ Promotion Threshold in force; null while unset. */
  threshold: number | null;
  /** The day after the last Role Evaluation's range; null before any. */
  since: string | null;
  /** My net Task Points since then (all time before any Role Evaluation). */
  points: number;
};

export async function fetchPromotionProgress(): Promise<PromotionProgress> {
  const [rulesRes, standingRes] = await Promise.all([
    supabase
      .from('promotion_rules')
      .select('from_role, to_role, kind, min_tenure_months, enabled'),
    supabase
      .rpc('my_role_evaluation_standing', { p_kind: 'voluntar_activ' })
      .maybeSingle(),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (standingRes.error) throw standingRes.error;

  // A disabled rule promotes nobody, so it promises no date.
  const tenure = (kind: string, from: string, to: string) =>
    rulesRes.data.find(
      (rule) =>
        rule.enabled &&
        rule.kind === kind &&
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
  enabled = true,
}: { enabled?: boolean } = {}) {
  const id = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.promotionProgress(id),
    queryFn: id && enabled ? fetchPromotionProgress : skipToken,
  });
}
