import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
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
it('sends Group and Campaign to the authoritative leaderboard', async () => {
  await fetchLeadershipLeaderboard({ groupId: 12, campaignId: 6 });
  expect(api.rpc).toHaveBeenCalledWith('leadership_leaderboard', {
    p_group_id: 12,
    p_campaign_id: 6,
  });
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
it('Cup accepts Campaign only and member history accepts the target uuid', async () => {
  await fetchLeadershipCup(6);
  await fetchLeadershipMemberTasks('member');
  expect(api.rpc).toHaveBeenCalledWith('department_cup', { p_campaign_id: 6 });
  expect(api.rpc).toHaveBeenCalledWith('leadership_member_tasks', {
    p_member_id: 'member',
  });
  expect(order).toHaveBeenCalledWith('assignment_id');
});
it('reads paged Group and Campaign options without category exclusions', async () => {
  await fetchLeadershipFilters();
  expect(api.from.mock.calls).toEqual([['groups'], ['campaigns']]);
  expect(builder.select.mock.calls).toEqual([
    ['id,name,path,status'],
    ['id,name,group_id'],
  ]);
  expect(range).toHaveBeenCalledTimes(2);
});
