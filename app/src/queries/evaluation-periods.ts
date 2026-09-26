import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

type MemberRole = Database['public']['Enums']['member_role'];

/** An Evaluation Period (#47), as the Perioade de evaluare panel reads it. */
export type EvaluationPeriod = {
  id: number;
  name: string;
  opened_at: string;
  closed_at: string | null;
  closing_threshold: number | null;
};

/** Every Period, newest first. Every live active Member reads every row. */
export async function fetchEvaluationPeriods(): Promise<EvaluationPeriod[]> {
  const { data, error } = await supabase
    .from('evaluation_periods')
    .select('id, name, opened_at, closed_at, closing_threshold')
    .order('opened_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function useEvaluationPeriods() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.periods(memberId),
    queryFn: memberId ? fetchEvaluationPeriods : skipToken,
  });
}

/** The open Period, if any (#47 allows at most one). */
export function openPeriod(periods: readonly EvaluationPeriod[]) {
  return periods.find((period) => period.closed_at === null) ?? null;
}

/** The most recently closed Period, by its closing instant. */
export function lastClosedPeriod(periods: readonly EvaluationPeriod[]) {
  return (
    periods
      .filter((period) => period.closed_at !== null)
      .sort(
        (a, b) =>
          Date.parse(b.closed_at as string) -
            Date.parse(a.closed_at as string) || b.id - a.id,
      )[0] ?? null
  );
}

/**
 * Where the Promotion Threshold in force comes from, as
 * `promotion_threshold_in_force()` (#49) picks it: the most recently closed
 * Period that carries a stamp, else the initial threshold. A close that ranked
 * nobody stamps nothing, so it is skipped rather than read as "no threshold".
 */
export function thresholdSource(periods: readonly EvaluationPeriod[]) {
  return (
    periods
      .filter(
        (period) =>
          period.closed_at !== null && period.closing_threshold !== null,
      )
      .sort(
        (a, b) =>
          Date.parse(b.closed_at as string) -
            Date.parse(a.closed_at as string) || b.id - a.id,
      )[0] ?? null
  );
}

/** The Promotion Threshold in force and the rule BC seeds it on. */
export type PromotionThreshold = {
  inForce: number | null;
  /** The `top_percent` Promotion Rule, or null when none is seeded. */
  rule: { id: number; initialThreshold: number } | null;
};

export async function fetchPromotionThreshold(): Promise<PromotionThreshold> {
  const [inForce, rule] = await Promise.all([
    supabase.rpc('promotion_threshold_in_force'),
    supabase
      .from('promotion_rules')
      .select('id, initial_threshold')
      .eq('kind', 'top_percent')
      .maybeSingle(),
  ]);
  if (inForce.error) throw inForce.error;
  if (rule.error) throw rule.error;
  return {
    inForce: inForce.data ?? null,
    rule:
      rule.data && rule.data.initial_threshold !== null
        ? { id: rule.data.id, initialThreshold: rule.data.initial_threshold }
        : null,
  };
}

export function usePromotionThreshold() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.threshold(memberId),
    queryFn: memberId ? fetchPromotionThreshold : skipToken,
  });
}

/** A Retention Signal: a holder a closed Period left outside their share (#48). */
export type RetentionSignal = {
  memberId: string;
  role: MemberRole;
  taskPoints: number;
  rank: number;
  cohortSize: number;
  shareSize: number;
};

/**
 * The rows of `retention_ranking(p_period_id)` marked below their share. BC
 * and the Moderator read every row under #512's rule; the server decides.
 */
export async function fetchRetentionSignals(
  periodId: number,
): Promise<RetentionSignal[]> {
  const { data, error } = await supabase.rpc('retention_ranking', {
    p_period_id: periodId,
  });
  if (error) throw error;
  return (data ?? [])
    .filter((row) => !row.inside)
    .map((row) => ({
      memberId: row.member_id,
      role: row.role,
      taskPoints: row.task_points,
      rank: row.rank,
      cohortSize: row.cohort_size,
      shareSize: row.share_size,
    }));
}

export function useRetentionSignals(periodId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.signals(periodId, memberId),
    queryFn:
      memberId && periodId !== null
        ? () => fetchRetentionSignals(periodId)
        : skipToken,
  });
}

/** The organization settings (#681), by key. */
export async function fetchOrgSettings(): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('key, value');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.key, row.value]));
}

export function useOrgSettings() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.orgSettings.list(memberId),
    queryFn: memberId ? fetchOrgSettings : skipToken,
  });
}

/** What the panel asks the server to do. */
export type PeriodCommand =
  | { kind: 'open'; name: string }
  | { kind: 'close'; periodId: number }
  | { kind: 'initialThreshold'; ruleId: number; threshold: number }
  | {
      kind: 'orgSetting';
      key: 'adherence_form_url' | 'adunarea_generala_group_id';
      value: string | null;
    };

const FAILED: Record<PeriodCommand['kind'], string> = {
  open: 'Nu am putut deschide perioada. Reîncearcă.',
  close: 'Nu am putut închide perioada. Reîncearcă.',
  initialThreshold: 'Nu am putut salva pragul inițial. Reîncearcă.',
  orgSetting: 'Nu am putut salva setarea. Reîncearcă.',
};

export async function runPeriodCommand(command: PeriodCommand) {
  const result =
    command.kind === 'open'
      ? await supabase.rpc('open_evaluation_period', { p_name: command.name })
      : command.kind === 'close'
        ? await supabase.rpc('close_evaluation_period', {
            p_period_id: command.periodId,
          })
        : command.kind === 'initialThreshold'
          ? await supabase.rpc('set_promotion_rule', {
              p_rule_id: command.ruleId,
              p_initial_threshold: command.threshold,
            })
          : await supabase.rpc('set_org_setting', {
              p_key: command.key,
              // A blank value clears the setting on the server too.
              p_value: command.value ?? '',
            });
  if (result.error) throw new CommandError(result.error, FAILED[command.kind]);
}

/**
 * One mutation for the panel. Opening, closing and seeding refresh the Period,
 * threshold and signal reads together (`['evaluation']`); a close also
 * promotes Members, so the rosters and Roles Administrare shows are refreshed
 * with it. A setting refreshes the settings.
 */
export function usePeriodCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runPeriodCommand,
    onSettled: (_data, _error, command) =>
      Promise.all(
        command.kind === 'orgSetting'
          ? [client.invalidateQueries({ queryKey: keys.orgSettings.all })]
          : [
              client.invalidateQueries({ queryKey: keys.evaluation.all }),
              ...(command.kind === 'close'
                ? [
                    client.invalidateQueries({ queryKey: keys.groups.all }),
                    client.invalidateQueries({ queryKey: keys.members.all }),
                  ]
                : []),
            ],
      ),
  });
}
