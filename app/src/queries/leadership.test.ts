import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { withoutGroup } from '../lib/work-filter';
import {
  fetchLeadershipLeaderboard,
  fetchLeadershipCup,
  fetchLeadershipMemberTasks,
  fetchLeadershipFilters,
  fetchLeaderboardIdentities,
} from './leadership';
const range = vi.fn();
const order = vi.fn();
const builder = { order, range, select: vi.fn(), in: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  order.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
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
  await fetchLeadershipMemberTasks('member', {
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(api.rpc).toHaveBeenCalledWith('department_cup', {
    p_campaign_id: 6,
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(api.rpc).toHaveBeenCalledWith('leadership_member_tasks', {
    p_member_id: 'member',
  });
  // The tracker's range reads the Task deadline on the server (#677).
  expect(api.rpc).toHaveBeenCalledWith('leadership_member_tasks', {
    p_member_id: 'member',
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(order).toHaveBeenCalledWith('assignment_id');
});
it('reads paged Group and Campaign options without category exclusions', async () => {
  await fetchLeadershipFilters();
  expect(api.from.mock.calls).toEqual([['groups'], ['campaigns']]);
  expect(builder.select.mock.calls).toEqual([
    ['id,name,path,status,is_organization,parent_id,color,category'],
    ['id,name,group_id'],
  ]);
  expect(range).toHaveBeenCalledTimes(2);
});

it('batches the row identities by member id: avatar colour, first top-level Group, +n', async () => {
  const groups = [
    {
      id: 1,
      name: 'OSUBB',
      parent_id: null,
      color: null,
      status: 'active',
      is_organization: true,
    },
    {
      id: 7,
      name: 'Educație',
      parent_id: null,
      color: '#284C93',
      status: 'active',
      is_organization: false,
    },
    {
      id: 9,
      name: 'Mentorat',
      parent_id: 7,
      color: null,
      status: 'active',
      is_organization: false,
    },
    {
      id: 11,
      name: 'Financiar',
      parent_id: null,
      color: '#007F33',
      status: 'active',
      is_organization: false,
    },
    {
      id: 12,
      name: 'Arhivat',
      parent_id: null,
      color: null,
      status: 'archived',
      is_organization: false,
    },
  ];
  const tables: Record<string, unknown[]> = {
    groups,
    profiles_directory: [
      { id: 'a', avatar_color: '#123456' },
      { id: 'b', avatar_color: null },
    ],
    group_members: [
      { member_id: 'a', group_id: 1, created_at: '2025-01-01T00:00:00Z' },
      { member_id: 'a', group_id: 11, created_at: '2025-03-01T00:00:00Z' },
      { member_id: 'a', group_id: 7, created_at: '2025-02-01T00:00:00Z' },
      { member_id: 'a', group_id: 9, created_at: '2025-01-15T00:00:00Z' },
      { member_id: 'a', group_id: 12, created_at: '2024-01-01T00:00:00Z' },
      { member_id: 'b', group_id: 11, created_at: '2025-05-01T00:00:00Z' },
    ],
  };
  let table = '';
  api.from.mockImplementation((name: string) => {
    table = name;
    return builder;
  });
  range.mockImplementation(async () => ({ data: tables[table], error: null }));
  const identities = await fetchLeaderboardIdentities(['a', 'b', 'c']);
  expect(builder.in).toHaveBeenCalledWith('id', ['a', 'b', 'c']);
  expect(builder.in).toHaveBeenCalledWith('member_id', ['a', 'b', 'c']);
  // The Organization and archived Groups say nothing; the earliest-joined
  // top-level Group is the chip, even when a Child Group was joined earlier.
  expect(identities).toEqual({
    a: {
      avatarColor: '#123456',
      primaryGroup: { id: 7, name: 'Educație', color: '#284C93' },
      otherMemberships: 2,
    },
    b: {
      avatarColor: null,
      primaryGroup: { id: 11, name: 'Financiar', color: '#007F33' },
      otherMemberships: 0,
    },
    c: { avatarColor: null, primaryGroup: null, otherMemberships: 0 },
  });
});

it('splits a long board into id chunks so no request URL grows unbounded', async () => {
  const ids = Array.from({ length: 250 }, (_, index) => `m${index}`);
  await fetchLeaderboardIdentities(ids);
  const chunks = builder.in.mock.calls
    .filter(([column]) => column === 'id')
    .map(([, values]) => (values as string[]).length);
  expect(chunks).toEqual([100, 100, 50]);
});
