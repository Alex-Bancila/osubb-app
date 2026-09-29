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
  for (const method of ['select', 'is', 'eq', 'order']) {
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

import {
  fetchPromotionCandidates,
  fetchRoleEvaluationRanking,
  fetchRoleEvaluations,
  fetchThresholdChanges,
  fetchEvaluationPercents,
  fetchPromotionRules,
  latestRun,
  percentText,
  retentionSignals,
  runRoleEvaluationCommand,
  type RankingRow,
  type RoleEvaluation,
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
  ...extra,
});

beforeEach(() => {
  db.results = new Map();
  db.calls = [];
});

describe('the Role Evaluation reads (#827 over #826)', () => {
  it('reads the runs newest first', async () => {
    db.results.set('role_evaluations', { data: [run({})], error: null });
    expect(await fetchRoleEvaluations()).toEqual([run({})]);
    expect(db.calls).toContainEqual([
      'role_evaluations',
      'order',
      'run_at',
      { ascending: false },
    ]);
  });

  it('reads the threshold log newest first, with which value changed', async () => {
    db.results.set('promotion_threshold_changes', { data: [], error: null });
    await fetchThresholdChanges();
    expect(db.calls).toContainEqual([
      'promotion_threshold_changes',
      'select',
      'id, kind, field, promotion_rule_id, from_value, to_value, source, changed_by, role_evaluation_id, changed_at',
    ]);
    expect(db.calls).toContainEqual([
      'promotion_threshold_changes',
      'order',
      'changed_at',
      { ascending: false },
    ]);
  });

  it('reads both Promotion Rules, the ladder in order (#935)', async () => {
    db.results.set('promotion_rules', {
      data: [
        {
          id: 5,
          kind: 'top_percent',
          from_role: 'voluntar',
          to_role: 'activ',
          min_tenure_months: 12,
          enabled: false,
        },
        {
          id: 9,
          kind: 'time',
          from_role: 'recrut',
          to_role: 'voluntar',
          min_tenure_months: 6,
          enabled: true,
        },
      ],
      error: null,
    });
    expect(await fetchPromotionRules()).toEqual([
      {
        id: 9,
        kind: 'time',
        fromRole: 'recrut',
        toRole: 'voluntar',
        tenureMonths: 6,
        enabled: true,
      },
      {
        id: 5,
        kind: 'top_percent',
        fromRole: 'voluntar',
        toRole: 'activ',
        tenureMonths: 12,
        enabled: false,
      },
    ]);
    expect(db.calls).toContainEqual([
      'promotion_rules',
      'select',
      'id, kind, from_role, to_role, min_tenure_months, enabled',
    ]);
  });

  it('reads only undecided candidates, joined to the run that listed them', async () => {
    db.results.set('promotion_candidates', {
      data: [
        {
          id: 7,
          member_id: 'ana',
          task_points: 48,
          tenure_since: '2026-03-15',
          role_evaluation_id: 1,
          role_evaluation: { name: 'Semestrul I', threshold_used: 30 },
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
    expect(String(select?.[2])).toContain(
      'role_evaluations!promotion_candidates_role_evaluation_id_fkey(name, threshold_used)',
    );
  });

  it('ranks a run over its own kind and range', async () => {
    db.results.set('role_evaluation_ranking', {
      data: [
        {
          member_id: 'ana',
          role: 'activ',
          task_points: 12,
          rank: 2,
          cohort_size: 2,
          share_size: 1,
          inside: false,
          tenure_since: null,
        },
      ],
      error: null,
    });
    expect(await fetchRoleEvaluationRanking(run({}))).toEqual([
      {
        memberId: 'ana',
        role: 'activ',
        taskPoints: 12,
        rank: 2,
        cohortSize: 2,
        shareSize: 1,
        inside: false,
      },
    ]);
    expect(db.calls).toContainEqual([
      'rpc',
      'role_evaluation_ranking',
      { p_kind: 'voluntar_activ', p_from: '2026-02-01', p_to: '2026-06-30' },
    ]);
  });

  it('reads x and y, and who changed each last, from evaluation_percents (#866)', async () => {
    db.results.set('evaluation_percents', {
      data: [
        {
          kind: 'voluntar_activ',
          percent: 35,
          changed_at: '2026-09-28T09:00:00Z',
          changed_by: 'bc',
        },
        {
          kind: 'adunarea_generala',
          percent: 25,
          changed_at: null,
          changed_by: null,
        },
      ],
      error: null,
    });
    const percents = await fetchEvaluationPercents();
    expect(percents).toEqual([
      {
        kind: 'voluntar_activ',
        percent: 35,
        changedAt: '2026-09-28T09:00:00Z',
        changedBy: 'bc',
      },
      {
        kind: 'adunarea_generala',
        percent: 25,
        changedAt: null,
        changedBy: null,
      },
    ]);
    expect(db.calls).toContainEqual(['rpc', 'evaluation_percents', undefined]);
    expect(percentText(percents, 'voluntar_activ')).toBe('35');
    expect(percentText(percents, 'adunarea_generala')).toBe('25');
    expect(percentText(undefined, 'voluntar_activ')).toBe('—');
  });

  it('throws a read error rather than showing an empty list', async () => {
    db.results.set('role_evaluations', {
      data: null,
      error: new Error('boom'),
    });
    await expect(fetchRoleEvaluations()).rejects.toThrow('boom');
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

  it('signals every holder of the kind’s Role below the threshold used', () => {
    const row = (extra: Partial<RankingRow>): RankingRow => ({
      memberId: 'x',
      role: 'activ',
      taskPoints: 0,
      rank: 1,
      cohortSize: 3,
      shareSize: 1,
      inside: false,
      ...extra,
    });
    const ranking = [
      row({ memberId: 'at-line', taskPoints: 30 }),
      row({ memberId: 'below', taskPoints: 12, rank: 2 }),
      row({ memberId: 'lowest', taskPoints: 3, rank: 3 }),
      row({ memberId: 'voluntar', role: 'voluntar', taskPoints: 1 }),
    ];
    expect(
      retentionSignals(run({}), ranking).map((signal) => signal.memberId),
    ).toEqual(['lowest', 'below']);
    expect(
      retentionSignals(run({ kind: 'adunarea_generala' }), [
        row({ memberId: 'vot', role: 'vot', taskPoints: 5 }),
        row({ memberId: 'activ', taskPoints: 5 }),
      ]).map((signal) => signal.memberId),
    ).toEqual(['vot']);
  });
});

describe('the commands', () => {
  it('runs a Role Evaluation and reports its counts', async () => {
    db.results.set('run_role_evaluation', {
      data: [{ role_evaluation_id: 9, candidates: 2, retention_signals: 1 }],
      error: null,
    });
    expect(
      await runRoleEvaluationCommand({
        kind: 'run',
        evaluationKind: 'voluntar_activ',
        from: '2026-07-01',
        to: '2026-09-28',
        name: 'Semestrul II',
      }),
    ).toEqual({ roleEvaluationId: 9, candidates: 2, retentionSignals: 1 });
    expect(db.calls).toContainEqual([
      'rpc',
      'run_role_evaluation',
      {
        p_kind: 'voluntar_activ',
        p_from: '2026-07-01',
        p_to: '2026-09-28',
        p_name: 'Semestrul II',
      },
    ]);
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

  it('edits a Promotion Rule through update_promotion_rule (#935)', async () => {
    await runRoleEvaluationCommand({
      kind: 'rule',
      ruleId: 3,
      tenureMonths: 0,
      enabled: false,
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'update_promotion_rule',
      { p_rule_id: 3, p_min_tenure_months: 0, p_enabled: false },
    ]);
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
});
