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
import { readAllRows } from './read-all';

type MemberRole = Database['public']['Enums']['member_role'];

/**
 * A Role Evaluation (#826, ruling R28): one immutable run. Since R58 it also
 * records the values it ranked with — the Eligibility Floor (`eligibility_floor`),
 * the kind's share (`percent_used`), the Membership Cutoff Date it listed
 * Candidates by (`membership_cutoff`, the Voluntar Activ kind only) — and how
 * many Members it evaluated (`evaluated_count`; `ranked_count` of them reached
 * the Floor). A run recorded before R58 has those four null, and its
 * `threshold_used` may be null too: a first run of a kind needs no line before
 * it. `threshold_used` is the line in force before the run, `threshold_computed`
 * the line this run computed (null when nobody reached the Floor).
 */
export type RoleEvaluation = {
  id: number;
  kind: string;
  name: string;
  period_from: string;
  period_to: string;
  run_by: string;
  run_at: string;
  threshold_used: number | null;
  threshold_computed: number | null;
  ranked_count: number;
  eligibility_floor: number | null;
  percent_used: number | null;
  membership_cutoff: string | null;
  evaluated_count: number | null;
};

/** Every Role Evaluation, newest run first. Every live active Member reads every row. */
export async function fetchRoleEvaluations(): Promise<RoleEvaluation[]> {
  const { data, error } = await supabase
    .from('role_evaluations')
    .select(
      'id, kind, name, period_from, period_to, run_by, run_at, threshold_used, threshold_computed, ranked_count, eligibility_floor, percent_used, membership_cutoff, evaluated_count',
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
 * a hand edit, a run's write-through or the day-one change a migration made;
 * #866, ruling R30), or — kept as history since R58 dropped the Promotion
 * Rules — a rule's tenure in months (`field` tenure) or on/off state (`field`
 * enabled, 0 off and 1 on), naming the rule instead of a kind (#935). Since
 * R58 also the three evaluation settings, naming neither a kind nor a rule:
 * the Eligibility Floor (`field` floor, a number in `to_value`) and the two
 * dates (`field` cutoff and points_start, the day moved to in `to_date` and
 * the day before in `from_date`, with no number). `source` is also
 * `migration` for a change a migration made.
 */
export type ThresholdChange = {
  id: number;
  kind: string | null;
  field: string;
  promotion_rule_id: number | null;
  from_value: number | null;
  /** Null exactly for a date field (cutoff, points_start). */
  to_value: number | null;
  /** The day before and after a date field's change; null for the others. */
  from_date: string | null;
  to_date: string | null;
  source: string;
  changed_by: string | null;
  role_evaluation_id: number | null;
  changed_at: string;
};

/** The threshold log, newest first. BC and the Moderator read it (level 6). */
export async function fetchThresholdChanges(): Promise<ThresholdChange[]> {
  return readAllRows((from, to) =>
    supabase
      .from('promotion_threshold_changes')
      .select(
        'id, kind, field, promotion_rule_id, from_value, to_value, from_date, to_date, source, changed_by, role_evaluation_id, changed_at',
      )
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
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
  const rows = await readAllRows((from, to) =>
    supabase
      .from('promotion_candidates')
      .select(
        'id, member_id, task_points, tenure_since, threshold_used, created_at, role_evaluation_id, role_evaluation:role_evaluations!promotion_candidates_role_evaluation_id_fkey(name)',
      )
      .is('decision', null)
      .order('task_points', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
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

/**
 * The values a run and its Simulation rank with (R58): the kind, the
 * Evaluation Period, the Eligibility Floor (`floor`, whole points, at least
 * 1), the kind's share (`percent`, 1–100) and — for the Voluntar Activ kind
 * only, `null` for the other — the Membership Cutoff Date a Candidate must
 * have joined by. `name` is the run's, and a Simulation has none.
 */
export type RunValues = {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  name: string;
  floor: number;
  percent: number;
  cutoff: string | null;
};

/**
 * One Member of a ranking (R58), from `simulate_role_evaluation` or
 * `role_evaluation_ranking`. `ranked` says the Member reached the Eligibility
 * Floor and so shaped the percentile; only they have a `rank` (ties share
 * one). Every row carries the same totals: `evaluatedCount` Members
 * evaluated, `rankedCount` of them ranked, `shareSize` of those inside the
 * share, and the `line` — the Task Points of the last Member inside, null
 * when nobody was ranked. `inside` means ranked at or above the line;
 * `listable` (the Voluntar Activ kind) means a Voluntar who joined by the
 * Membership Cutoff Date, who becomes a Promotion Candidate when inside.
 */
export type RankingRow = {
  memberId: string;
  role: MemberRole;
  taskPoints: number;
  ranked: boolean;
  rank: number | null;
  evaluatedCount: number;
  rankedCount: number;
  shareSize: number;
  line: number | null;
  inside: boolean;
  listable: boolean;
};

/** A server row as the page reads it. The types call `rank` and `line` non-null; the SQL returns null. */
function rankingRow(
  row: Database['public']['Functions']['role_evaluation_ranking']['Returns'][number],
): RankingRow {
  return {
    memberId: row.member_id,
    role: row.role,
    taskPoints: row.task_points,
    ranked: row.ranked,
    rank: row.rank as number | null,
    evaluatedCount: row.evaluated_count,
    rankedCount: row.ranked_count,
    shareSize: row.share_size,
    line: row.line as number | null,
    inside: row.inside,
    listable: row.listable,
  };
}

/**
 * The Simulation (Simulare, R58): the ranking a run with these values would
 * produce, over the Evaluation Period, written nowhere. BC and the Moderator
 * only; the server refuses anyone else and a value it would refuse in a run
 * (`invalid_eligibility_floor`, `invalid_percent`, `membership_cutoff_not_set`
 * …). A cohort is every evaluated Member and passes 500, so the rows are read
 * in pages in the server's order, the Member last to keep the pages stable.
 * The Adunarea Generală kind has no cutoff: the argument is left out and the
 * function reads its null default.
 */
export async function simulateRoleEvaluation(
  values: Omit<RunValues, 'name'>,
): Promise<RankingRow[]> {
  const rows = await readAllRows((from, to) =>
    supabase
      .rpc('simulate_role_evaluation', {
        p_kind: values.kind,
        p_from: values.from,
        p_to: values.to,
        p_floor: values.floor,
        p_percent: values.percent,
        p_cutoff: values.cutoff ?? undefined,
      })
      .order('task_points', { ascending: false })
      .order('member_id')
      .range(from, to),
  );
  return rows.map(rankingRow);
}

/**
 * The ranking of one recorded run, recomputed by the server from the values
 * the run recorded (so the rows its Simulation showed, while the ledger is
 * unchanged). Empty for a run recorded before R58; only the caller's own row
 * for a session without #512's read. `PT404 role_evaluation_not_found` for an
 * unknown run.
 */
export async function fetchRoleEvaluationRanking(
  runId: number,
): Promise<RankingRow[]> {
  const rows = await readAllRows((from, to) =>
    supabase
      .rpc('role_evaluation_ranking', { p_role_evaluation_id: runId })
      .order('task_points', { ascending: false })
      .order('member_id')
      .range(from, to),
  );
  return rows.map(rankingRow);
}

/**
 * The ranking of one finalised run; nothing is read while no run is chosen.
 * BC, the Moderator and #512's readers get every row; the server decides.
 */
export function useRoleEvaluationRanking(runId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.ranking(runId, memberId),
    queryFn:
      memberId && runId !== null
        ? () => fetchRoleEvaluationRanking(runId)
        : skipToken,
  });
}

/**
 * A stored Retention Signal (R58): an open `retention_signals` row — a holder
 * a finalised run found below the line (`below_line`) or the Eligibility Floor
 * (`below_floor`), or a voter whose Universitate is known and is not UBB
 * (`not_ubb_student`, live, with no run). `kind` is the Role Evaluation kind
 * it belongs to, `roleAtListing` the Role the Member held when it was raised.
 * `thresholdUsed` is the figure the Member fell under: the line for
 * `below_line`, the run's Eligibility Floor for `below_floor`. The points and
 * the figure are null for a Universitate Signal.
 */
export type RetentionSignal = {
  id: number;
  kind: string;
  memberId: string;
  roleAtListing: MemberRole;
  reason: 'below_line' | 'below_floor' | 'not_ubb_student';
  taskPoints: number | null;
  thresholdUsed: number | null;
  roleEvaluationId: number | null;
  listedAt: string;
};

/**
 * The open Retention Signals (`closed_at is null`), the kind then the lowest
 * points first (a Universitate Signal has none, so it follows). BC and the
 * Moderator read them (level 6); anyone else reads none.
 */
export async function fetchRetentionSignals(): Promise<RetentionSignal[]> {
  const rows = await readAllRows((from, to) =>
    supabase
      .from('retention_signals')
      .select(
        'id, kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id, created_at',
      )
      .is('closed_at', null)
      .order('kind', { ascending: true })
      .order('task_points', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    memberId: row.member_id,
    roleAtListing: row.role_at_listing,
    // A CHECK constraint holds the three values.
    reason: row.reason as RetentionSignal['reason'],
    taskPoints: row.task_points,
    thresholdUsed: row.threshold_used,
    roleEvaluationId: row.role_evaluation_id,
    listedAt: row.created_at,
  }));
}

export function useRetentionSignals() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.evaluation.signals(memberId),
    queryFn: memberId ? fetchRetentionSignals : skipToken,
  });
}

/**
 * The Roles whose holders a run of each kind measures against its line
 * (R58): both kinds rank every Member below BCE (the Adunarea Generală kind
 * the very pool the Voluntar Activ kind does, Alex 2026-10-24), but only a
 * Voluntar Activ or a Voluntar cu Drept de Vot can fall below the Voluntar
 * Activ line; the Adunarea Generală kind judges the voters alone.
 */
const SIGNAL_ROLES: Record<RoleEvaluationKind, readonly MemberRole[]> = {
  voluntar_activ: ['activ', 'vot'],
  adunarea_generala: ['vot'],
};

/**
 * What a Simulation (or a recorded run's ranking) says it would do, from the
 * rows alone, by the rules `run_role_evaluation` applies (R58): the `line`,
 * the counts, the Promotion `candidates` (the Voluntar Activ kind: `listable`
 * and `inside`, highest points first) and the `signals` (a holder of the
 * kind's Role not inside: `below_line` when ranked, `below_floor` when not;
 * lowest points first). A voter whose Universitate is not UBB raises a third
 * Signal the rows cannot show: it is live, not a result of a run.
 */
export function simulationOutcome(
  rows: readonly RankingRow[],
  kind: RoleEvaluationKind,
): {
  line: number | null;
  rankedCount: number;
  evaluatedCount: number;
  candidates: RankingRow[];
  signals: { row: RankingRow; reason: 'below_line' | 'below_floor' }[];
} {
  const holders = SIGNAL_ROLES[kind];
  const byMember = (a: RankingRow, b: RankingRow) =>
    a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  const candidates =
    kind === 'voluntar_activ'
      ? rows
          .filter((row) => row.listable && row.inside)
          .sort((a, b) => b.taskPoints - a.taskPoints || byMember(a, b))
      : [];
  const signals = rows
    .filter((row) => holders.includes(row.role) && !row.inside)
    .sort((a, b) => a.taskPoints - b.taskPoints || byMember(a, b))
    .map((row) => ({
      row,
      reason: row.ranked ? ('below_line' as const) : ('below_floor' as const),
    }));
  return {
    line: rows.find((row) => row.line !== null)?.line ?? null,
    rankedCount: rows[0]?.rankedCount ?? 0,
    evaluatedCount: rows[0]?.evaluatedCount ?? 0,
    candidates,
    signals,
  };
}

/** What the tab asks the server to do. */
export type RoleEvaluationCommand =
  | { kind: 'run'; values: RunValues }
  | { kind: 'threshold'; evaluationKind: RoleEvaluationKind; threshold: number }
  | { kind: 'percent'; evaluationKind: RoleEvaluationKind; percent: number }
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
  reject: 'Nu am putut respinge candidatul. Reîncearcă.',
};

export async function runRoleEvaluationCommand(
  command: RoleEvaluationCommand,
): Promise<RunResult | null> {
  if (command.kind === 'run') {
    const { values } = command;
    const { data, error } = await supabase.rpc('run_role_evaluation', {
      p_kind: values.kind,
      p_from: values.from,
      p_to: values.to,
      p_name: values.name,
      p_floor: values.floor,
      p_percent: values.percent,
      p_cutoff: values.cutoff ?? undefined,
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
        : await supabase.rpc('reject_promotion_candidate', {
            p_candidate_id: command.candidateId,
            p_reason: command.reason,
          });
  if (error) throw new CommandError(error, FAILED[command.kind]);
  return null;
}

/**
 * One mutation for the tab. Every command refreshes the runs, thresholds,
 * log, candidates, signals and rankings together (`['evaluation']`) and the
 * Profil progress bar that reads the threshold — after a refusal too, since a
 * stale page is what most refusals report.
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
