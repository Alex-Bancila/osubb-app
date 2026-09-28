import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  rules: { data: [], error: null } as Result,
  standing: { data: null, error: null } as Result,
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
      return builder(table, () => db.rules);
    },
    rpc: (fn: string, args?: unknown) => {
      db.calls.push(['rpc', fn, args]);
      return builder(fn, () => db.standing);
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

describe('fetchPromotionProgress (#634, #826)', () => {
  beforeEach(() => {
    db.rules = { data: RULES, error: null };
    db.standing = {
      data: { since: '2026-07-01', task_points: 12, threshold: 30 },
      error: null,
    };
    db.calls = [];
  });

  it('reads both rules and my own Voluntar Activ standing', async () => {
    await expect(fetchPromotionProgress()).resolves.toEqual({
      voluntarTenureMonths: 6,
      activTenureMonths: 4,
      threshold: 30,
      since: '2026-07-01',
      points: 12,
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'my_role_evaluation_standing',
      { p_kind: 'voluntar_activ' },
    ]);
    expect(db.calls).not.toContainEqual(
      expect.arrayContaining(['evaluation_period_ranking']),
    );
  });

  it('no standing row is zero points, no threshold and no start day', async () => {
    db.standing = { data: null, error: null };

    await expect(fetchPromotionProgress()).resolves.toMatchObject({
      threshold: null,
      since: null,
      points: 0,
    });
  });

  it('a disabled rule promises no tenure date', async () => {
    db.rules = {
      data: RULES.map((rule) =>
        rule.kind === 'top_percent' ? { ...rule, enabled: false } : rule,
      ),
      error: null,
    };

    const result = await fetchPromotionProgress();
    expect(result.voluntarTenureMonths).toBe(6);
    expect(result.activTenureMonths).toBeNull();
  });

  it('a threshold not yet entered stays null', async () => {
    db.standing = {
      data: { since: null, task_points: 3, threshold: null },
      error: null,
    };

    const result = await fetchPromotionProgress();
    expect(result.threshold).toBeNull();
    expect(result.points).toBe(3);
  });

  it('throws a failed read', async () => {
    const error = { message: 'denied', code: '42501' };
    db.rules = { data: null, error };

    await expect(fetchPromotionProgress()).rejects.toBe(error);
  });
});
