import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  results: new Map<string, Result>(),
  calls: [] as unknown[][],
}));

/** A chainable builder that records every call and resolves to its result. */
function builder(name: string) {
  const result = () => db.results.get(name) ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'is', 'eq', 'order', 'range']) {
    chain[method] = (...args: unknown[]) => {
      db.calls.push([name, method, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result());
  chain.then = (resolve: (value: Result) => unknown) => resolve(result());
  return chain;
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.calls.push(['from', table]);
      return builder(table);
    },
    rpc: (fn: string, args?: unknown) => {
      db.calls.push(['rpc', fn, args]);
      return builder(fn);
    },
  },
}));

import { runSchema } from '../lib/schemas/role-evaluation';
import {
  fetchPromotionCandidates,
  fetchRetentionSignals,
  fetchRoleEvaluationRanking,
  fetchRoleEvaluations,
  fetchThresholdChanges,
  latestRun,
  runRoleEvaluationCommand,
  simulateRoleEvaluation,
  simulationOutcome,
  type RankingRow,
  type RoleEvaluation,
  type RunValues,
} from './role-evaluations';

const run = (extra: Partial<RoleEvaluation>): RoleEvaluation => ({
  id: 1,
  kind: 'voluntar_activ',
  name: 'Semestrul I',
  period_from: '2026-02-01',
  period_to: '2026-06-30',
  run_by: 'bc',
  run_at: '2026-07-01T09:00:00Z',
  threshold_used: 30,
  threshold_computed: 42,
  ranked_count: 3,
  eligibility_floor: 10,
  percent_used: 35,
  membership_cutoff: '2026-03-01',
  evaluated_count: 8,
  ...extra,
});

/** What the form hands the Simulation and the run (R58). */
const VALUES: RunValues = {
  kind: 'voluntar_activ',
  from: '2026-03-01',
  to: '2026-09-30',
  name: 'Evaluare S1',
  floor: 10,
  percent: 35,
  cutoff: '2026-03-01',
};

/** One row of `role_evaluation_ranking` / `simulate_role_evaluation`. */
const SERVER_ROW = {
  member_id: 'ana',
  role: 'voluntar',
  task_points: 50,
  ranked: true,
  rank: 2,
  evaluated_count: 10,
  ranked_count: 8,
  share_size: 3,
  line: 40,
  inside: true,
  listable: true,
};

/** The same row as the page reads it. */
const PAGE_ROW: RankingRow = {
  memberId: 'ana',
  role: 'voluntar',
  taskPoints: 50,
  ranked: true,
  rank: 2,
  evaluatedCount: 10,
  rankedCount: 8,
  shareSize: 3,
  line: 40,
  inside: true,
  listable: true,
};

beforeEach(() => {
  db.results = new Map();
  db.calls = [];
});

describe('the Role Evaluation reads (#827 over #826)', () => {
  it('reads the runs newest first, with the values each run used (R58)', async () => {
    db.results.set('role_evaluations', { data: [run({})], error: null });
    expect(await fetchRoleEvaluations()).toEqual([run({})]);
    expect(db.calls).toContainEqual([
      'role_evaluations',
      'order',
      'run_at',
      { ascending: false },
    ]);
    expect(db.calls).toContainEqual([
      'role_evaluations',
      'select',
      'id, kind, name, period_from, period_to, run_by, run_at, threshold_used, threshold_computed, ranked_count, eligibility_floor, percent_used, membership_cutoff, evaluated_count',
    ]);
  });

  it('a run recorded before R58 keeps its new values null, and may have no line before it', async () => {
    const old = run({
      threshold_used: null,
      eligibility_floor: null,
      percent_used: null,
      membership_cutoff: null,
      evaluated_count: null,
    });
    db.results.set('role_evaluations', { data: [old], error: null });
    expect(await fetchRoleEvaluations()).toEqual([old]);
  });

  it('reads the threshold log newest first, with which value changed', async () => {
    db.results.set('promotion_threshold_changes', { data: [], error: null });
    await fetchThresholdChanges();
    expect(db.calls).toContainEqual([
      'promotion_threshold_changes',
      'select',
      'id, kind, field, promotion_rule_id, from_value, to_value, from_date, to_date, source, changed_by, role_evaluation_id, changed_at',
    ]);
    expect(db.calls).toContainEqual([
      'promotion_threshold_changes',
      'order',
      'changed_at',
      { ascending: false },
    ]);
  });

  it('reads only undecided candidates: a run row named after its run, a live row (#983) after the day it was listed', async () => {
    db.results.set('promotion_candidates', {
      data: [
        {
          id: 7,
          member_id: 'ana',
          task_points: 48,
          tenure_since: '2026-03-15',
          threshold_used: 30,
          created_at: '2026-07-01T09:00:00Z',
          role_evaluation_id: 1,
          role_evaluation: { name: 'Semestrul I' },
        },
        {
          id: 9,
          member_id: 'dan',
          task_points: 31,
          tenure_since: '2026-01-10',
          threshold_used: 30,
          created_at: '2026-10-02T08:30:00Z',
          role_evaluation_id: null,
          role_evaluation: null,
        },
      ],
      error: null,
    });
    expect(await fetchPromotionCandidates()).toEqual([
      {
        id: 7,
        memberId: 'ana',
        taskPoints: 48,
        tenureSince: '2026-03-15',
        roleEvaluationId: 1,
        evaluationName: 'Semestrul I',
        thresholdUsed: 30,
        listedAt: '2026-07-01T09:00:00Z',
      },
      {
        id: 9,
        memberId: 'dan',
        taskPoints: 31,
        tenureSince: '2026-01-10',
        roleEvaluationId: null,
        evaluationName: null,
        thresholdUsed: 30,
        listedAt: '2026-10-02T08:30:00Z',
      },
    ]);
    expect(db.calls).toContainEqual([
      'promotion_candidates',
      'is',
      'decision',
      null,
    ]);
    const select = db.calls.find(
      (call) => call[0] === 'promotion_candidates' && call[1] === 'select',
    );
    expect(String(select?.[2])).toContain('threshold_used, created_at');
    expect(String(select?.[2])).toContain(
      'role_evaluations!promotion_candidates_role_evaluation_id_fkey(name)',
    );
  });

  it('ranks a recorded run by its id alone, with the values the run recorded (R58)', async () => {
    db.results.set('role_evaluation_ranking', {
      data: [SERVER_ROW],
      error: null,
    });
    expect(await fetchRoleEvaluationRanking(12)).toEqual([PAGE_ROW]);
    expect(db.calls).toContainEqual([
      'rpc',
      'role_evaluation_ranking',
      { p_role_evaluation_id: 12 },
    ]);
    // Highest points first, the Member last so a page boundary is stable.
    expect(db.calls).toContainEqual([
      'role_evaluation_ranking',
      'order',
      'task_points',
      { ascending: false },
    ]);
    expect(db.calls).toContainEqual([
      'role_evaluation_ranking',
      'order',
      'member_id',
    ]);
  });

  it('an unranked Member has no rank, and a run that ranked nobody has no line', async () => {
    db.results.set('role_evaluation_ranking', {
      data: [{ ...SERVER_ROW, ranked: false, rank: null, line: null }],
      error: null,
    });
    expect(await fetchRoleEvaluationRanking(12)).toEqual([
      { ...PAGE_ROW, ranked: false, rank: null, line: null },
    ]);
  });

  it('throws a read error rather than showing an empty list', async () => {
    db.results.set('role_evaluations', {
      data: null,
      error: new Error('boom'),
    });
    await expect(fetchRoleEvaluations()).rejects.toThrow('boom');
  });
});

describe('the Simulation (R58)', () => {
  it('sends the six arguments of simulate_role_evaluation, and nothing else', async () => {
    db.results.set('simulate_role_evaluation', {
      data: [SERVER_ROW],
      error: null,
    });
    const { name: _name, ...simulated } = VALUES;
    expect(await simulateRoleEvaluation(simulated)).toEqual([PAGE_ROW]);
    expect(db.calls).toContainEqual([
      'rpc',
      'simulate_role_evaluation',
      {
        p_kind: 'voluntar_activ',
        p_from: '2026-03-01',
        p_to: '2026-09-30',
        p_floor: 10,
        p_percent: 35,
        p_cutoff: '2026-03-01',
      },
    ]);
    expect(db.calls).not.toContainEqual(
      expect.arrayContaining(['run_role_evaluation']),
    );
  });

  it('the Adunarea Generală kind has no cutoff to send', async () => {
    await simulateRoleEvaluation({
      kind: 'adunarea_generala',
      from: '2026-03-01',
      to: '2026-09-30',
      floor: 10,
      percent: 25,
      cutoff: null,
    });
    const call = db.calls.find((c) => c[1] === 'simulate_role_evaluation');
    expect(call?.[2]).toEqual({
      p_kind: 'adunarea_generala',
      p_from: '2026-03-01',
      p_to: '2026-09-30',
      p_floor: 10,
      p_percent: 25,
    });
    // PostgREST reads a missing argument as the function's null default.
    expect(call?.[2]).not.toHaveProperty('p_cutoff', expect.any(String));
  });

  it('throws what the server refused, and rows are read in stable pages', async () => {
    const error = { code: 'PT400', message: 'invalid_eligibility_floor' };
    db.results.set('simulate_role_evaluation', { data: null, error });
    await expect(
      simulateRoleEvaluation({
        kind: 'voluntar_activ',
        from: '2026-03-01',
        to: '2026-09-30',
        floor: 0,
        percent: 35,
        cutoff: '2026-03-01',
      }),
    ).rejects.toBe(error);
    expect(db.calls).toContainEqual([
      'simulate_role_evaluation',
      'order',
      'task_points',
      { ascending: false },
    ]);
    expect(db.calls).toContainEqual([
      'simulate_role_evaluation',
      'order',
      'member_id',
    ]);
  });
});

/**
 * Six Members evaluated over one period: a Floor of 10, 35 %, four ranked,
 * share size 2, the line 40 (the 2nd ranked Member's points).
 */
function row(extra: Partial<RankingRow> & { memberId: string }): RankingRow {
  return {
    role: 'voluntar',
    taskPoints: 0,
    ranked: true,
    rank: 1,
    evaluatedCount: 6,
    rankedCount: 4,
    shareSize: 2,
    line: 40,
    inside: false,
    listable: false,
    ...extra,
  };
}

const SIX_ROWS: RankingRow[] = [
  // A Recrut shapes the percentile but cannot be listed.
  row({ memberId: 'recrut', role: 'recrut', taskPoints: 60, inside: true }),
  // Two Voluntars who joined by the cutoff and are inside: the Candidates.
  row({
    memberId: 'ana',
    taskPoints: 50,
    rank: 2,
    inside: true,
    listable: true,
  }),
  row({
    memberId: 'dan',
    taskPoints: 40,
    rank: 3,
    inside: true,
    listable: true,
  }),
  // A Voluntar Activ ranked below the line: below_line.
  row({ memberId: 'activ', role: 'activ', taskPoints: 20, rank: 4 }),
  // A voter under the Floor: unranked, below_floor.
  row({
    memberId: 'vot',
    role: 'vot',
    taskPoints: 3,
    ranked: false,
    rank: null,
  }),
  // A Voluntar under the Floor: no holder, no Signal.
  row({
    memberId: 'voluntar',
    taskPoints: 2,
    ranked: false,
    rank: null,
    listable: true,
  }),
];

describe('simulationOutcome (R58)', () => {
  it('Voluntar Activ: the line, the counts, the listable Voluntars inside, and the holders not inside', () => {
    const outcome = simulationOutcome(SIX_ROWS, 'voluntar_activ');
    expect(outcome.line).toBe(40);
    expect(outcome.rankedCount).toBe(4);
    expect(outcome.evaluatedCount).toBe(6);
    expect(outcome.candidates.map((candidate) => candidate.memberId)).toEqual([
      'ana',
      'dan',
    ]);
    // Lowest points first: the Signals BC reads the way the stored ones are.
    expect(
      outcome.signals.map((signal) => [signal.row.memberId, signal.reason]),
    ).toEqual([
      ['vot', 'below_floor'],
      ['activ', 'below_line'],
    ]);
  });

  it('Adunarea Generală: the whole pool is ranked, but no Candidates and only voters raise Signals', () => {
    const outcome = simulationOutcome(
      [
        row({ memberId: 'a', role: 'vot', taskPoints: 30, inside: true }),
        row({ memberId: 'b', role: 'vot', taskPoints: 12, rank: 2 }),
        row({
          memberId: 'c',
          role: 'vot',
          taskPoints: 1,
          ranked: false,
          rank: null,
        }),
        // The rest of the pool is ranked beside the voters (Alex, 2026-10-24)
        // but not judged: a Voluntar Activ under the line raises nothing.
        row({ memberId: 'd', role: 'activ', taskPoints: 2 }),
        row({ memberId: 'e', role: 'voluntar', listable: true, inside: true }),
      ],
      'adunarea_generala',
    );
    expect(outcome.candidates).toEqual([]);
    expect(
      outcome.signals.map((signal) => [signal.row.memberId, signal.reason]),
    ).toEqual([
      ['c', 'below_floor'],
      ['b', 'below_line'],
    ]);
  });

  it('nobody ranked: no line, and every holder is below the Floor', () => {
    const outcome = simulationOutcome(
      [
        row({
          memberId: 'x',
          role: 'activ',
          ranked: false,
          rank: null,
          line: null,
          rankedCount: 0,
          evaluatedCount: 1,
        }),
      ],
      'voluntar_activ',
    );
    expect(outcome).toMatchObject({
      line: null,
      rankedCount: 0,
      evaluatedCount: 1,
      candidates: [],
    });
    expect(outcome.signals.map((signal) => signal.reason)).toEqual([
      'below_floor',
    ]);
  });

  it('an empty population is an empty outcome', () => {
    expect(simulationOutcome([], 'voluntar_activ')).toEqual({
      line: null,
      rankedCount: 0,
      evaluatedCount: 0,
      candidates: [],
      signals: [],
    });
  });
});

describe('the stored Retention Signals (R58)', () => {
  it('reads the open rows, the kind then the lowest points first', async () => {
    db.results.set('retention_signals', {
      data: [
        {
          id: 4,
          kind: 'adunarea_generala',
          member_id: 'ion',
          role_at_listing: 'vot',
          reason: 'not_ubb_student',
          task_points: null,
          threshold_used: null,
          role_evaluation_id: null,
          created_at: '2026-10-18T09:00:00Z',
        },
        {
          id: 3,
          kind: 'voluntar_activ',
          member_id: 'ana',
          role_at_listing: 'activ',
          reason: 'below_line',
          task_points: 12,
          threshold_used: 40,
          role_evaluation_id: 9,
          created_at: '2026-10-17T09:00:00Z',
        },
      ],
      error: null,
    });
    expect(await fetchRetentionSignals()).toEqual([
      {
        id: 4,
        kind: 'adunarea_generala',
        memberId: 'ion',
        roleAtListing: 'vot',
        reason: 'not_ubb_student',
        taskPoints: null,
        thresholdUsed: null,
        roleEvaluationId: null,
        listedAt: '2026-10-18T09:00:00Z',
      },
      {
        id: 3,
        kind: 'voluntar_activ',
        memberId: 'ana',
        roleAtListing: 'activ',
        reason: 'below_line',
        taskPoints: 12,
        thresholdUsed: 40,
        roleEvaluationId: 9,
        listedAt: '2026-10-17T09:00:00Z',
      },
    ]);
    const calls = db.calls.filter((call) => call[0] === 'retention_signals');
    expect(calls).toContainEqual([
      'retention_signals',
      'is',
      'closed_at',
      null,
    ]);
    // The order is the server's: kind, then points ascending, then the row.
    const orders = calls
      .filter((call) => call[1] === 'order')
      .map((call) => call.slice(2));
    expect(orders).toEqual([
      ['kind', { ascending: true }],
      ['task_points', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(String(calls.find((call) => call[1] === 'select')?.[2])).toBe(
      'id, kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id, created_at',
    );
  });

  it('throws a failed read', async () => {
    db.results.set('retention_signals', { data: null, error: new Error('x') });
    await expect(fetchRetentionSignals()).rejects.toThrow('x');
  });
});

describe('what the tab derives', () => {
  it('finds the kind’s newest run in a newest-first list', () => {
    const runs = [
      run({ id: 3, kind: 'adunarea_generala' }),
      run({ id: 2 }),
      run({ id: 1 }),
    ];
    expect(latestRun(runs, 'voluntar_activ')?.id).toBe(2);
    expect(latestRun(runs, 'adunarea_generala')?.id).toBe(3);
    expect(latestRun([], 'voluntar_activ')).toBeUndefined();
  });
});

describe('the commands', () => {
  it('the run form parses into the values a run takes', () => {
    // The form's own fields; the Prag minim and the Data limită de intrare
    // are the settings in force.
    const values: RunValues = runSchema('2026-09-30', {
      floor: 10,
      cutoff: '2026-03-01',
    }).parse({
      kind: 'voluntar_activ',
      from: '2026-03-01',
      to: '2026-09-30',
      name: ' Evaluare S1 ',
      percent: '35',
    });
    expect(values).toEqual(VALUES);
  });

  it('runs a Role Evaluation with its seven arguments and reports its counts', async () => {
    db.results.set('run_role_evaluation', {
      data: [{ role_evaluation_id: 9, candidates: 2, retention_signals: 1 }],
      error: null,
    });
    expect(
      await runRoleEvaluationCommand({ kind: 'run', values: VALUES }),
    ).toEqual({ roleEvaluationId: 9, candidates: 2, retentionSignals: 1 });
    expect(db.calls).toContainEqual([
      'rpc',
      'run_role_evaluation',
      {
        p_kind: 'voluntar_activ',
        p_from: '2026-03-01',
        p_to: '2026-09-30',
        p_name: 'Evaluare S1',
        p_floor: 10,
        p_percent: 35,
        p_cutoff: '2026-03-01',
      },
    ]);
  });

  it('an Adunarea Generală run sends no cutoff', async () => {
    db.results.set('run_role_evaluation', {
      data: [{ role_evaluation_id: 10, candidates: 0, retention_signals: 3 }],
      error: null,
    });
    await runRoleEvaluationCommand({
      kind: 'run',
      values: {
        ...VALUES,
        kind: 'adunarea_generala',
        percent: 25,
        cutoff: null,
      },
    });
    const call = db.calls.find((c) => c[1] === 'run_role_evaluation');
    expect(call?.[2]).toEqual({
      p_kind: 'adunarea_generala',
      p_from: '2026-03-01',
      p_to: '2026-09-30',
      p_name: 'Evaluare S1',
      p_floor: 10,
      p_percent: 25,
    });
    expect(call?.[2]).not.toHaveProperty('p_cutoff', expect.any(String));
  });

  it('sets a threshold, a share and rejects a candidate through their commands', async () => {
    await runRoleEvaluationCommand({
      kind: 'threshold',
      evaluationKind: 'adunarea_generala',
      threshold: 12,
    });
    await runRoleEvaluationCommand({
      kind: 'percent',
      evaluationKind: 'voluntar_activ',
      percent: 35,
    });
    await runRoleEvaluationCommand({
      kind: 'reject',
      candidateId: 7,
      reason: 'Motiv',
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'set_promotion_threshold',
      { p_kind: 'adunarea_generala', p_threshold: 12 },
    ]);
    expect(db.calls).toContainEqual([
      'rpc',
      'set_evaluation_percent',
      { p_kind: 'voluntar_activ', p_percent: 35 },
    ]);
    expect(db.calls).toContainEqual([
      'rpc',
      'reject_promotion_candidate',
      { p_candidate_id: 7, p_reason: 'Motiv' },
    ]);
  });

  it('has no command left for a Promotion Rule (R58)', async () => {
    await runRoleEvaluationCommand({
      kind: 'threshold',
      evaluationKind: 'voluntar_activ',
      threshold: 5,
    });
    expect(db.calls).not.toContainEqual(
      expect.arrayContaining(['update_promotion_rule']),
    );
  });

  it('carries the server reason of a refusal', async () => {
    db.results.set('reject_promotion_candidate', {
      data: null,
      error: { code: 'PT409', message: 'promotion_candidate_decided' },
    });
    await expect(
      runRoleEvaluationCommand({ kind: 'reject', candidateId: 7, reason: 'x' }),
    ).rejects.toMatchObject({ reason: 'promotion_candidate_decided' });
  });

  it('a refused run carries its reason too', async () => {
    db.results.set('run_role_evaluation', {
      data: null,
      error: { code: 'PT400', message: 'membership_cutoff_not_set' },
    });
    await expect(
      runRoleEvaluationCommand({
        kind: 'run',
        values: { ...VALUES, cutoff: null },
      }),
    ).rejects.toMatchObject({ reason: 'membership_cutoff_not_set' });
  });
});
