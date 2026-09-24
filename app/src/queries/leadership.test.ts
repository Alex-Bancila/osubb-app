import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { withoutGroup } from '../lib/work-filter';
import {
  fetchLeadershipLeaderboard,
  fetchLeadershipCup,
  fetchLeadershipMemberTasks,
  fetchLeadershipFilters,
} from './leadership';
const range = vi.fn();
const order = vi.fn();
const builder = { order, range, select: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  order.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  api.rpc.mockReturnValue(builder);
  api.from.mockReturnValue(builder);
  range.mockResolvedValue({ data: [], error: null });
});
it('sends the Work Filter arguments to the authoritative leaderboard', async () => {
  const filters = {
    p_group_id: 12,
    p_campaign_id: 6,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  };
  await fetchLeadershipLeaderboard(filters);
  expect(api.rpc).toHaveBeenCalledWith('leadership_leaderboard', filters);
  expect(order).toHaveBeenCalledWith('member_id');
});
it('pages all results with stable ordering and rejects a partial answer', async () => {
  range
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, member_id) => ({ member_id })),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await expect(fetchLeadershipLeaderboard({})).rejects.toThrow('offline');
  expect(range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
  ]);
});
it('Cup takes the Campaign and range but never the Group; member history takes the uuid', async () => {
  await fetchLeadershipCup(
    withoutGroup({
      p_group_id: 12,
      p_campaign_id: 6,
      p_to: '2026-09-30T21:00:00.000Z',
    }),
  );
  await fetchLeadershipMemberTasks('member');
  expect(api.rpc).toHaveBeenCalledWith('department_cup', {
    p_campaign_id: 6,
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(api.rpc).toHaveBeenCalledWith('leadership_member_tasks', {
    p_member_id: 'member',
  });
  expect(order).toHaveBeenCalledWith('assignment_id');
});
it('reads paged Group and Campaign options without category exclusions', async () => {
  await fetchLeadershipFilters();
  expect(api.from.mock.calls).toEqual([['groups'], ['campaigns']]);
  expect(builder.select.mock.calls).toEqual([
    ['id,name,path,status,is_organization'],
    ['id,name,group_id'],
  ]);
  expect(range).toHaveBeenCalledTimes(2);
});
