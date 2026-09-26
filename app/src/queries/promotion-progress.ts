import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * #634 — what the profile needs to show a Member where they stand on the
 * automatic ladder (ADR-0004 as amended 2026-09-21, rulings R9, R13, R18).
 *
 * Everything here is read, never computed: the tenure each Promotion Rule
 * demands (#49), the Promotion Threshold in force — a constant fixed at the
 * previous close, so the bar's target does not move all semester (#49) — and
 * the Member's own row of the open Evaluation Period's ranking (#47). The
 * ranking RPC returns only the caller's row to an ordinary Member; the
 * `member_id` filter keeps that true for anyone else too. No rank is kept:
 * the page never shows one (ruling R6).
 */
export type PromotionProgress = {
  /** The Evaluation Period with `closed_at` null, if one is open. */
  openPeriod: { id: number; name: string } | null;
  /** Months of tenure the enabled Recrut → Voluntar (`time`) rule demands. */
  voluntarTenureMonths: number | null;
  /** Months of tenure the enabled Voluntar → Voluntar Activ (`top_percent`) rule demands. */
  activTenureMonths: number | null;
  /** `promotion_threshold_in_force()`; null when there is none. */
  threshold: number | null;
  /** My net Task Points inside the open Period; null when none is open. */
  periodPoints: number | null;
};

export async function fetchPromotionProgress(
  memberId: string,
): Promise<PromotionProgress> {
  const [periodRes, rulesRes, thresholdRes] = await Promise.all([
    supabase
      .from('evaluation_periods')
      .select('id, name')
      .is('closed_at', null)
      .maybeSingle(),
    supabase
      .from('promotion_rules')
      .select('from_role, to_role, kind, min_tenure_months, enabled'),
    supabase.rpc('promotion_threshold_in_force'),
  ]);
  if (periodRes.error) throw periodRes.error;
  if (rulesRes.error) throw rulesRes.error;
  if (thresholdRes.error) throw thresholdRes.error;

  // A disabled rule promotes nobody (#51/#52), so it promises no date.
  const tenure = (kind: string, from: string, to: string) =>
    rulesRes.data.find(
      (rule) =>
        rule.enabled &&
        rule.kind === kind &&
        rule.from_role === from &&
        rule.to_role === to,
    )?.min_tenure_months ?? null;

  const openPeriod = periodRes.data;
  let periodPoints: number | null = null;
  if (openPeriod) {
    const rankingRes = await supabase
      .rpc('evaluation_period_ranking', { p_period_id: openPeriod.id })
      .eq('member_id', memberId)
      .maybeSingle();
    if (rankingRes.error) throw rankingRes.error;
    // No row: no in-Period Evaluation credited me yet — zero, not unknown.
    periodPoints = rankingRes.data?.task_points ?? 0;
  }

  return {
    openPeriod,
    voluntarTenureMonths: tenure('time', 'recrut', 'voluntar'),
    activTenureMonths: tenure('top_percent', 'voluntar', 'activ'),
    // The generated type says number; the SQL returns null with no rule.
    threshold: (thresholdRes.data as number | null) ?? null,
    periodPoints,
  };
}

export function usePromotionProgress({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const id = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.promotionProgress(id),
    queryFn: id && enabled ? () => fetchPromotionProgress(id) : skipToken,
  });
}
