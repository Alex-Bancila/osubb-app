import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import type { RoleEvaluationKind } from '../lib/schemas/role-evaluation';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

type MemberRole = Database['public']['Enums']['member_role'];

/** A Role Evaluation (#826, ruling R28): one immutable run. */
export type RoleEvaluation = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_by: string;
  run_at: string;
  threshold_used: number;
  threshold_computed: number | null;
  ranked_count: number;
};

/** Every Role Evaluation, newest run first. Every live active Member reads every row. */
export async function fetchRoleEvaluations(): Promise<RoleEvaluation[]> {
  const { data, error } = await supabase
    .from('role_evaluations')
    .select(
      'id, kind, name, period_from, period_to, run_by, run_at, threshold_used, threshold_computed, ranked_count',
    )
    .order('run_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function useRoleEvaluations() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.roleEvaluations(memberId),
    queryFn: memberId ? fetchRoleEvaluations : skipToken,
  });
}

/** The kind's newest run (the list is newest first), if any. */
export function latestRun(
  evaluations: readonly RoleEvaluation[],
  kind: RoleEvaluationKind,
): RoleEvaluation | undefined {
  return evaluations.find((evaluation) => evaluation.kind === kind);
}

/** The Promotion Threshold in force for one kind; `threshold` null while unset. */
export type PromotionThreshold = {
  kind: string;
  threshold: number | null;
  updated_at: string;
  updated_by: string | null;
};

export async function fetchPromotionThresholds(): Promise<
  PromotionThreshold[]
> {
  const { data, error } = await supabase
    .from('promotion_thresholds')
    .select('kind, threshold, updated_at, updated_by');
  if (error) throw error;
  return data ?? [];
}

export function usePromotionThresholds() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.thresholds(memberId),
    queryFn: memberId ? fetchPromotionThresholds : skipToken,
  });
}

/**
 * One change in the Praguri log: a Promotion Threshold (`field` threshold —
 * a hand edit or a run's hand-over), a kind's top share (`field` percent,
 * always a hand edit; #866, ruling R30), or a Promotion Rule's tenure in
 * months (`field` tenure) or on/off state (`field` enabled, 0 off and 1 on) —
 * always a hand edit, naming the rule instead of a kind (#935).
 */
export type ThresholdChange = {
  id: number;
  kind: string | null;
  field: string;
  promotion_rule_id: number | null;
  from_value: number | null;
  to_value: number;
  source: string;
  changed_by: string | null;
  role_evaluation_id: number | null;
  changed_at: string;
};

/** The threshold log, newest first. BC and the Moderator read it (level 6). */
export async function fetchThresholdChanges(): Promise<ThresholdChange[]> {
  const { data, error } = await supabase
    .from('promotion_threshold_changes')
    .select(
      'id, kind, field, promotion_rule_id, from_value, to_value, source, changed_by, role_evaluation_id, changed_at',
    )
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function useThresholdChanges() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.thresholdChanges(memberId),
    queryFn: memberId ? fetchThresholdChanges : skipToken,
  });
}

/**
 * An undecided Promotion Candidate: listed by a run (`roleEvaluationId` and
 * `evaluationName` set) or, since #983, between runs the moment they
 * qualified (both null; `listedAt` says when). `thresholdUsed` is the line the
 * row was measured against.
 */
export type PromotionCandidate = {
  id: number;
  memberId: string;
  taskPoints: number;
  tenureSince: string;
  roleEvaluationId: number | null;
  evaluationName: string | null;
  thresholdUsed: number;
  listedAt: string;
};

/** The open candidates (`decision is null`), highest points first. */
export async function fetchPromotionCandidates(): Promise<
  PromotionCandidate[]
> {
  const { data, error } = await supabase
    .from('promotion_candidates')
    .select(
      'id, member_id, task_points, tenure_since, threshold_used, created_at, role_evaluation_id, role_evaluation:role_evaluations!promotion_candidates_role_evaluation_id_fkey(name)',
    )
    .is('decision', null)
    .order('task_points', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    taskPoints: row.task_points,
    tenureSince: row.tenure_since,
    roleEvaluationId: row.role_evaluation_id,
    evaluationName: row.role_evaluation?.name ?? null,
    thresholdUsed: row.threshold_used,
    listedAt: row.created_at,
  }));
}

export function usePromotionCandidates() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.candidates(memberId),
    queryFn: memberId ? fetchPromotionCandidates : skipToken,
  });
}

/** One row of `role_evaluation_ranking(kind, from, to)`. */
export type RankingRow = {
  memberId: string;
  role: MemberRole;
  taskPoints: number;
  rank: number;
  cohortSize: number;
  shareSize: number;
  inside: boolean;
};

export async function fetchRoleEvaluationRanking(
  run: Pick<RoleEvaluation, 'kind' | 'period_from' | 'period_to'>,
): Promise<RankingRow[]> {
  const { data, error } = await supabase.rpc('role_evaluation_ranking', {
    p_kind: run.kind,
    p_from: run.period_from,
    p_to: run.period_to,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    memberId: row.member_id,
    role: row.role,
    taskPoints: row.task_points,
    rank: row.rank,
    cohortSize: row.cohort_size,
    shareSize: row.share_size,
    inside: row.inside,
  }));
}

/**
 * The ranking of one run's kind over its Evaluation Period. BC, the Moderator
 * and #512's readers get every row; the server decides.
 */
export function useRoleEvaluationRanking(run: RoleEvaluation | undefined) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.ranking(
      run ? { kind: run.kind, from: run.period_from, to: run.period_to } : null,
      memberId,
    ),
    queryFn:
      memberId && run ? () => fetchRoleEvaluationRanking(run) : skipToken,
  });
}

/** The Role each kind's Retention Signals are about (#826 decision 3). */
export const HOLDER_ROLE: Record<RoleEvaluationKind, MemberRole> = {
  voluntar_activ: 'activ',
  adunarea_generala: 'vot',
};

/**
 * A run's Retention Signals: every holder of the kind's Role whose Task Points
 * fell below the threshold that run used — the line `run_role_evaluation`
 * notified BC of — lowest points first.
 */
export function retentionSignals(
  run: RoleEvaluation,
  ranking: readonly RankingRow[],
): RankingRow[] {
  const holder = HOLDER_ROLE[run.kind as RoleEvaluationKind];
  return ranking
    .filter((row) => row.role === holder && row.taskPoints < run.threshold_used)
    .sort((a, b) => a.taskPoints - b.taskPoints || a.rank - b.rank);
}

/**
 * A kind's top share in force (#866, ruling R30): x for Voluntar Activ (the
 * `top_percent` rule's percent), y for the Adunarea Generală (the Vote
 * Retention Threshold), with who changed it last and when — null before any
 * change, and for anyone below BC.
 */
export type EvaluationPercent = {
  kind: string;
  percent: number | null;
  changedAt: string | null;
  changedBy: string | null;
};

/** Both shares, from `evaluation_percents()`: Voluntar Activ first. */
export async function fetchEvaluationPercents(): Promise<EvaluationPercent[]> {
  const { data, error } = await supabase.rpc('evaluation_percents');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    kind: row.kind,
    // Null for a session that reads neither share nor log (RLS).
    percent: row.percent as number | null,
    changedAt: row.changed_at as string | null,
    changedBy: row.changed_by as string | null,
  }));
}

export function useEvaluationPercents() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.percents(memberId),
    queryFn: memberId ? fetchEvaluationPercents : skipToken,
  });
}

/** One kind's share as the run confirmation writes it, `—` while unknown. */
export function percentText(
  percents: readonly EvaluationPercent[] | undefined,
  kind: RoleEvaluationKind,
): string {
  const percent = percents?.find((row) => row.kind === kind)?.percent;
  return percent === null || percent === undefined ? '—' : String(percent);
}

/**
 * A Promotion Rule (#49; editable since #935): the tenure in whole months
 * counted from the join date, and whether the rule is on. `time` is Recrut →
 * Voluntar (the daily job), `top_percent` Voluntar → Voluntar Activ (the
 * Voluntar Activ Role Evaluation's candidates).
 */
export type PromotionRule = {
  id: number;
  kind: string;
  fromRole: MemberRole;
  toRole: MemberRole;
  tenureMonths: number;
  enabled: boolean;
};

/** Both rules, Recrut → Voluntar first. Every live active Member reads them. */
export async function fetchPromotionRules(): Promise<PromotionRule[]> {
  const { data, error } = await supabase
    .from('promotion_rules')
    .select('id, kind, from_role, to_role, min_tenure_months, enabled')
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      fromRole: row.from_role,
      toRole: row.to_role,
      tenureMonths: row.min_tenure_months,
      enabled: row.enabled,
    }))
    .sort((a, b) => ruleOrder(a.kind) - ruleOrder(b.kind) || a.id - b.id);
}

/** The ladder's order: the time rule (the first step) before top_percent. */
function ruleOrder(kind: string): number {
  return kind === 'time' ? 0 : 1;
}

export function usePromotionRules() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.rules(memberId),
    queryFn: memberId ? fetchPromotionRules : skipToken,
  });
}

/** What the tab asks the server to do. */
export type RoleEvaluationCommand =
  | {
      kind: 'run';
      evaluationKind: RoleEvaluationKind;
      from: string;
      to: string;
      name: string;
    }
  | { kind: 'threshold'; evaluationKind: RoleEvaluationKind; threshold: number }
  | { kind: 'percent'; evaluationKind: RoleEvaluationKind; percent: number }
  | { kind: 'rule'; ruleId: number; tenureMonths: number; enabled: boolean }
  | { kind: 'reject'; candidateId: number; reason: string };

/** What a run reports back. */
export type RunResult = {
  roleEvaluationId: number;
  candidates: number;
  retentionSignals: number;
};

const FAILED: Record<RoleEvaluationCommand['kind'], string> = {
  run: 'Nu am putut rula evaluarea. Reîncearcă.',
  threshold: 'Nu am putut salva pragul. Reîncearcă.',
  percent: 'Nu am putut salva procentul. Reîncearcă.',
  rule: 'Nu am putut salva regula. Reîncearcă.',
  reject: 'Nu am putut respinge candidatul. Reîncearcă.',
};

export async function runRoleEvaluationCommand(
  command: RoleEvaluationCommand,
): Promise<RunResult | null> {
  if (command.kind === 'run') {
    const { data, error } = await supabase.rpc('run_role_evaluation', {
      p_kind: command.evaluationKind,
      p_from: command.from,
      p_to: command.to,
      p_name: command.name,
    });
    if (error) throw new CommandError(error, FAILED.run);
    const row = data?.[0];
    return {
      roleEvaluationId: row?.role_evaluation_id ?? 0,
      candidates: row?.candidates ?? 0,
      retentionSignals: row?.retention_signals ?? 0,
    };
  }
  const { error } =
    command.kind === 'threshold'
      ? await supabase.rpc('set_promotion_threshold', {
          p_kind: command.evaluationKind,
          p_threshold: command.threshold,
        })
      : command.kind === 'percent'
        ? await supabase.rpc('set_evaluation_percent', {
            p_kind: command.evaluationKind,
            p_percent: command.percent,
          })
        : command.kind === 'rule'
          ? await supabase.rpc('update_promotion_rule', {
              p_rule_id: command.ruleId,
              p_min_tenure_months: command.tenureMonths,
              p_enabled: command.enabled,
            })
          : await supabase.rpc('reject_promotion_candidate', {
              p_candidate_id: command.candidateId,
              p_reason: command.reason,
            });
  if (error) throw new CommandError(error, FAILED[command.kind]);
  return null;
}

/**
 * One mutation for the tab. Every command refreshes the runs, thresholds,
 * log, candidates and rankings together (`['evaluation']`) and the Profil
 * progress bar that reads the threshold — after a refusal too, since a stale
 * page is what most refusals report.
 */
export function useRoleEvaluationCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runRoleEvaluationCommand,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.evaluation.all }),
        client.invalidateQueries({
          queryKey: keys.points.promotionProgressAll,
        }),
      ]),
  });
}
