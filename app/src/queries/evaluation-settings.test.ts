import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
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
  for (const method of ['select', 'eq']) {
    chain[method] = (...args: unknown[]) => {
      db.calls.push([name, method, ...args]);
      return chain;
    };
  }
  chain.single = () => Promise.resolve(result());
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

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'm1' } } }),
}));

import { keys } from './keys';
import {
  fetchEvaluationSettings,
  pointsPeriodText,
  pointsSinceText,
  runEvaluationSettingCommand,
  useEvaluationSettingCommand,
  usePointsStartDate,
} from './evaluation-settings';

const SETTINGS_ROW = {
  eligibility_floor: 10,
  membership_cutoff: '2026-03-01',
  points_start_date: '2026-09-01',
  updated_at: '2026-10-18T09:00:00Z',
  updated_by: 'bc',
};

beforeEach(() => {
  db.results = new Map();
  db.calls = [];
});

describe('the evaluation settings read (R58)', () => {
  it("reads the settings' one row and maps it to camelCase", async () => {
    db.results.set('evaluation_settings', { data: SETTINGS_ROW, error: null });
    expect(await fetchEvaluationSettings()).toEqual({
      eligibilityFloor: 10,
      membershipCutoff: '2026-03-01',
      pointsStartDate: '2026-09-01',
      updatedAt: '2026-10-18T09:00:00Z',
      updatedBy: 'bc',
    });
    expect(db.calls).toContainEqual([
      'evaluation_settings',
      'select',
      'eligibility_floor, membership_cutoff, points_start_date, updated_at, updated_by',
    ]);
    expect(db.calls).toContainEqual(['evaluation_settings', 'eq', 'id', 1]);
  });

  it('keeps an unset value null', async () => {
    db.results.set('evaluation_settings', {
      data: {
        ...SETTINGS_ROW,
        eligibility_floor: null,
        membership_cutoff: null,
        points_start_date: null,
        updated_by: null,
      },
      error: null,
    });
    expect(await fetchEvaluationSettings()).toMatchObject({
      eligibilityFloor: null,
      membershipCutoff: null,
      pointsStartDate: null,
      updatedBy: null,
    });
  });

  it('throws what the server refused', async () => {
    const error = { code: '42501', message: 'denied' };
    db.results.set('evaluation_settings', { data: null, error });
    await expect(fetchEvaluationSettings()).rejects.toBe(error);
  });
});

describe('the three setting commands (R58)', () => {
  it('sets the Eligibility Floor through set_eligibility_floor', async () => {
    await runEvaluationSettingCommand({ kind: 'floor', points: 12 });
    expect(db.calls).toContainEqual([
      'rpc',
      'set_eligibility_floor',
      { p_points: 12 },
    ]);
  });

  it('sets the Membership Cutoff through set_membership_cutoff', async () => {
    await runEvaluationSettingCommand({ kind: 'cutoff', date: '2026-03-01' });
    expect(db.calls).toContainEqual([
      'rpc',
      'set_membership_cutoff',
      { p_date: '2026-03-01' },
    ]);
  });

  it('sets the Points Start Date through set_points_start_date', async () => {
    await runEvaluationSettingCommand({
      kind: 'pointsStart',
      date: '2026-09-01',
    });
    expect(db.calls).toContainEqual([
      'rpc',
      'set_points_start_date',
      { p_date: '2026-09-01' },
    ]);
  });

  it.each([
    [
      { kind: 'floor', points: 0 },
      'set_eligibility_floor',
      'invalid_eligibility_floor',
      'Pragul minim este un număr întreg de cel puțin 1.',
    ],
    [
      { kind: 'cutoff', date: '2999-01-01' },
      'set_membership_cutoff',
      'invalid_membership_cutoff',
      'Data limită de intrare este o zi de cel târziu azi.',
    ],
    [
      { kind: 'pointsStart', date: '2999-01-01' },
      'set_points_start_date',
      'invalid_points_start_date',
      'Data de început a punctajului este o zi de cel târziu azi.',
    ],
  ] as const)(
    'carries the reason of a refusal of %j as a CommandError',
    async (command, rpc, reason, copy) => {
      db.results.set(rpc, {
        data: null,
        error: { code: 'PT400', message: reason },
      });
      await expect(runEvaluationSettingCommand(command)).rejects.toMatchObject({
        name: 'CommandError',
        reason,
        message: copy,
      });
    },
  );

  it('falls back to its own copy for a failure it has no reason for', async () => {
    db.results.set('set_points_start_date', {
      data: null,
      error: { message: 'connection reset' },
    });
    await expect(
      runEvaluationSettingCommand({ kind: 'pointsStart', date: '2026-09-01' }),
    ).rejects.toMatchObject({
      name: 'CommandError',
      message: 'Nu am putut salva data de început a punctajului. Reîncearcă.',
    });
  });
});

describe('pointsSinceText', () => {
  it('writes the date as the Notifications do, dotted', () => {
    expect(pointsSinceText('2026-09-01')).toBe('din 01.09.2026');
    expect(pointsSinceText('2026-12-31')).toBe('din 31.12.2026');
  });

  it('is null while there is no date, or the date is not one', () => {
    expect(pointsSinceText(null)).toBeNull();
    expect(pointsSinceText(undefined)).toBeNull();
    expect(pointsSinceText('')).toBeNull();
    // Not the display dash of a missing day: a malformed one is simply not a day.
    expect(pointsSinceText('—')).toBeNull();
    expect(pointsSinceText('1 septembrie')).toBeNull();
  });
});

describe('pointsPeriodText', () => {
  it('begins at the Points Start Date when the filter has no De la', () => {
    expect(pointsPeriodText({}, '2026-09-01')).toBe('din 01.09.2026');
    expect(pointsPeriodText({ to: '2026-09-30' }, '2026-09-01')).toBe(
      'din 01.09.2026 până la 30 septembrie 2026',
    );
  });

  it('reads an explicit De la as the range it is, before the start or not', () => {
    expect(pointsPeriodText({ from: '2026-08-01' }, '2026-09-01')).toBe(
      'din 1 august 2026',
    );
    expect(
      pointsPeriodText({ from: '2026-08-01', to: '2026-09-30' }, '2026-09-01'),
    ).toBe('între 1 august 2026 și 30 septembrie 2026');
  });

  it('is null for the whole record: no date set, nothing chosen', () => {
    expect(pointsPeriodText({}, null)).toBeNull();
    expect(pointsPeriodText({ to: '2026-09-30' }, null)).toBe(
      'până la 30 septembrie 2026',
    );
  });

  it('is undefined while the date is unknown, unless a De la is chosen', () => {
    expect(pointsPeriodText({}, undefined)).toBeUndefined();
    expect(pointsPeriodText({ to: '2026-09-30' }, undefined)).toBeUndefined();
    expect(pointsPeriodText({ from: '2026-08-01' }, undefined)).toBe(
      'din 1 august 2026',
    );
  });
});

describe('the hooks', () => {
  function wrapperFor(client: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
  }

  it('usePointsStartDate is undefined while loading, then the one field', async () => {
    db.results.set('evaluation_settings', { data: SETTINGS_ROW, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => usePointsStartDate(), {
      wrapper: wrapperFor(client),
    });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('2026-09-01'));
    expect(client.getQueryData(keys.evaluation.settings('m1'))).toMatchObject({
      pointsStartDate: '2026-09-01',
    });
  });

  it('usePointsStartDate is null once the settings say none is set', async () => {
    db.results.set('evaluation_settings', {
      data: { ...SETTINGS_ROW, points_start_date: null },
      error: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => usePointsStartDate(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('a command refreshes the evaluation, points and campaign families, after a refusal too', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useEvaluationSettingCommand(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync({ kind: 'floor', points: 5 });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: keys.campaigns.all,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.evaluation.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.points.all });

    invalidate.mockClear();
    db.results.set('set_eligibility_floor', {
      data: null,
      error: { code: 'PT400', message: 'invalid_eligibility_floor' },
    });
    await expect(
      result.current.mutateAsync({ kind: 'floor', points: 0 }),
    ).rejects.toMatchObject({ reason: 'invalid_eligibility_floor' });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: keys.evaluation.all,
      }),
    );
  });
});
