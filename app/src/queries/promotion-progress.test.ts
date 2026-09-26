import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  period: { data: null, error: null } as Result,
  rules: { data: [], error: null } as Result,
  threshold: { data: null, error: null } as Result,
  ranking: { data: null, error: null } as Result,
  calls: [] as unknown[][],
}));

/** A chainable builder that records every call and resolves to `result`. */
function builder(name: string, result: () => Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'is', 'eq']) {
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
      return builder(
        table,
        table === 'evaluation_periods' ? () => db.period : () => db.rules,
      );
    },
    rpc: (fn: string, args?: unknown) => {
      db.calls.push(['rpc', fn, args]);
      return builder(
        fn,
        fn === 'promotion_threshold_in_force'
          ? () => db.threshold
          : () => db.ranking,
      );
    },
  },
}));

import { fetchPromotionProgress } from './promotion-progress';

const RULES = [
  {
    from_role: 'recrut',
    to_role: 'voluntar',
    kind: 'time',
    min_tenure_months: 6,
    enabled: true,
  },
  {
    from_role: 'voluntar',
    to_role: 'activ',
    kind: 'top_percent',
    min_tenure_months: 4,
    enabled: true,
  },
];

describe('fetchPromotionProgress (#634)', () => {
  beforeEach(() => {
    db.period = { data: { id: 7, name: 'Semestrul I' }, error: null };
    db.rules = { data: RULES, error: null };
    db.threshold = { data: 30, error: null };
    db.ranking = { data: { task_points: 12 }, error: null };
    db.calls = [];
  });

  it('reads the open Period, both rules, the threshold in force and my own ranking row', async () => {
    await expect(fetchPromotionProgress('m1')).resolves.toEqual({
      openPeriod: { id: 7, name: 'Semestrul I' },
      voluntarTenureMonths: 6,
      activTenureMonths: 4,
      threshold: 30,
      periodPoints: 12,
    });
    expect(db.calls).toContainEqual([
      'evaluation_periods',
      'is',
      'closed_at',
      null,
    ]);
    expect(db.calls).toContainEqual([
      'rpc',
      'promotion_threshold_in_force',
      undefined,
    ]);
    expect(db.calls).toContainEqual([
      'rpc',
      'evaluation_period_ranking',
      { p_period_id: 7 },
    ]);
    expect(db.calls).toContainEqual([
      'evaluation_period_ranking',
      'eq',
      'member_id',
      'm1',
    ]);
  });

  it('no ranking row inside the open Period is zero points', async () => {
    db.ranking = { data: null, error: null };

    const result = await fetchPromotionProgress('m1');
    expect(result.periodPoints).toBe(0);
  });

  it('with no open Period it never asks for a ranking', async () => {
    db.period = { data: null, error: null };

    const result = await fetchPromotionProgress('m1');
    expect(result.openPeriod).toBeNull();
    expect(result.periodPoints).toBeNull();
    expect(db.calls).not.toContainEqual(
      expect.arrayContaining(['evaluation_period_ranking']),
    );
  });

  it('a disabled rule promises no tenure date', async () => {
    db.rules = {
      data: RULES.map((rule) =>
        rule.kind === 'top_percent' ? { ...rule, enabled: false } : rule,
      ),
      error: null,
    };

    const result = await fetchPromotionProgress('m1');
    expect(result.voluntarTenureMonths).toBe(6);
    expect(result.activTenureMonths).toBeNull();
  });

  it('a null threshold stays null', async () => {
    db.threshold = { data: null, error: null };

    const result = await fetchPromotionProgress('m1');
    expect(result.threshold).toBeNull();
  });

  it('throws a failed read', async () => {
    const error = { message: 'denied', code: '42501' };
    db.rules = { data: null, error };

    await expect(fetchPromotionProgress('m1')).rejects.toBe(error);
  });
});
