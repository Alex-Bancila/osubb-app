import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  settings: { data: null, error: null } as Result,
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
  chain.single = () => Promise.resolve(result());
  chain.maybeSingle = () => Promise.resolve(result());
  chain.then = (resolve: (value: Result) => unknown) => resolve(result());
  return chain;
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.calls.push(['from', table]);
      return builder(table, () => db.settings);
    },
    rpc: (fn: string, args?: unknown) => {
      db.calls.push(['rpc', fn, args]);
      return builder(fn, () => db.standing);
    },
  },
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'm1' } } }),
}));

import {
  fetchPromotionProgress,
  roleEvaluationKindFor,
  tenureState,
  usePromotionProgress,
} from './promotion-progress';

/** The evaluation settings' one row (R58), the cutoff set. */
const SETTINGS = {
  eligibility_floor: 10,
  membership_cutoff: '2026-03-01',
  points_start_date: null,
  activ_percent: 35,
  vot_percent: 25,
  updated_at: '2026-10-18T09:00:00Z',
  updated_by: 'bc',
};

describe('roleEvaluationKindFor (#828, R28)', () => {
  it.each([
    ['recrut', 'voluntar_activ'],
    ['voluntar', 'voluntar_activ'],
    ['activ', 'voluntar_activ'],
    ['vot', 'adunarea_generala'],
  ])('%s reads the %s kind', (role, kind) => {
    expect(roleEvaluationKindFor(role)).toBe(kind);
  });
});

describe('tenureState (R58)', () => {
  it('is met when the Member joined on or before the cutoff', () => {
    expect(tenureState('2026-02-15', '2026-03-01')).toEqual({
      cutoff: '2026-03-01',
      joinedAt: '2026-02-15',
      met: true,
    });
    // The cutoff day itself counts, as the server's `joined_at <= cutoff`.
    expect(tenureState('2026-03-01', '2026-03-01').met).toBe(true);
  });

  it('is unmet when the Member joined after the cutoff', () => {
    expect(tenureState('2026-03-02', '2026-03-01')).toEqual({
      cutoff: '2026-03-01',
      joinedAt: '2026-03-02',
      met: false,
    });
  });

  it('is unmet while no cutoff is set: nobody is listed meanwhile', () => {
    expect(tenureState('2020-01-01', null)).toEqual({
      cutoff: null,
      joinedAt: '2020-01-01',
      met: false,
    });
  });

  it('is unmet for a Member with no join date', () => {
    expect(tenureState(null, '2026-03-01')).toEqual({
      cutoff: '2026-03-01',
      joinedAt: null,
      met: false,
    });
  });
});

describe('fetchPromotionProgress (#634, #826, #828, R58)', () => {
  beforeEach(() => {
    db.settings = { data: SETTINGS, error: null };
    db.standing = {
      data: { since: '2026-07-01', task_points: 12, threshold: 30 },
      error: null,
    };
    db.calls = [];
  });

  it('reads the Membership Cutoff Date and my own Voluntar Activ standing', async () => {
    await expect(fetchPromotionProgress('voluntar_activ')).resolves.toEqual({
      membershipCutoff: '2026-03-01',
      threshold: 30,
      since: '2026-07-01',
      points: 12,
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'my_role_evaluation_standing',
      { p_kind: 'voluntar_activ' },
    ]);
    expect(db.calls).toContainEqual(['from', 'evaluation_settings']);
    expect(db.calls).not.toContainEqual(
      expect.arrayContaining(['evaluation_period_ranking']),
    );
  });

  it('reads no Promotion Rule: R58 dropped them', async () => {
    await fetchPromotionProgress('voluntar_activ');
    expect(db.calls).not.toContainEqual(['from', 'promotion_rules']);
  });

  it('a cutoff not yet set stays null', async () => {
    db.settings = {
      data: { ...SETTINGS, membership_cutoff: null },
      error: null,
    };

    const result = await fetchPromotionProgress('voluntar_activ');
    expect(result.membershipCutoff).toBeNull();
    expect(result.points).toBe(12);
  });

  it('a Voluntar cu Drept de Vot reads the Adunarea Generală standing', async () => {
    db.standing = {
      data: { since: '2026-06-01', task_points: 40, threshold: 55 },
      error: null,
    };

    await expect(
      fetchPromotionProgress('adunarea_generala'),
    ).resolves.toMatchObject({
      threshold: 55,
      since: '2026-06-01',
      points: 40,
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'my_role_evaluation_standing',
      { p_kind: 'adunarea_generala' },
    ]);
    expect(db.calls).not.toContainEqual([
      'rpc',
      'my_role_evaluation_standing',
      { p_kind: 'voluntar_activ' },
    ]);
  });

  it('no request reads an Evaluation Period any more', async () => {
    await fetchPromotionProgress('voluntar_activ');
    expect(db.calls).not.toContainEqual(['from', 'evaluation_periods']);
  });

  it('no standing row is zero points, no threshold and no start day', async () => {
    db.standing = { data: null, error: null };

    await expect(
      fetchPromotionProgress('voluntar_activ'),
    ).resolves.toMatchObject({
      threshold: null,
      since: null,
      points: 0,
    });
  });

  it('a threshold not yet entered stays null', async () => {
    db.standing = {
      data: { since: null, task_points: 3, threshold: null },
      error: null,
    };

    const result = await fetchPromotionProgress('voluntar_activ');
    expect(result.threshold).toBeNull();
    expect(result.points).toBe(3);
  });

  it('throws a failed read', async () => {
    const error = { message: 'denied', code: '42501' };
    db.settings = { data: null, error };

    await expect(fetchPromotionProgress('voluntar_activ')).rejects.toBe(error);
  });
});

describe('usePromotionProgress (#828)', () => {
  beforeEach(() => {
    db.settings = { data: SETTINGS, error: null };
    db.standing = {
      data: { since: null, task_points: 0, threshold: 50 },
      error: null,
    };
    db.calls = [];
  });

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      children,
    );
  }

  it.each([
    ['voluntar', 'voluntar_activ'],
    ['activ', 'voluntar_activ'],
    ['vot', 'adunarea_generala'],
  ])('a %s holder reads the %s standing', async (role, kind) => {
    const { result } = renderHook(() => usePromotionProgress({ role }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db.calls).toContainEqual([
      'rpc',
      'my_role_evaluation_standing',
      { p_kind: kind },
    ]);
  });
});
