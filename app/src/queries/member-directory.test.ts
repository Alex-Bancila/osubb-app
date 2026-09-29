import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: mocks }));
import { fetchMemberDirectory } from './member-directory';

const fixtures: Record<string, unknown[]> = {
  profiles_directory: [
    { id: 'a', full_name: 'Ana', role: 'voluntar', status: 'activ' },
    { id: 'b', full_name: 'Bogdan', role: 'bc', status: 'alumni' },
  ],
  profiles_contact: [{ id: 'a', email: 'ana@example.test', phone: null }],
  // Ana's earliest membership overall is the child Logistică, but a child
  // never becomes the chip (R17): the earliest TOP-LEVEL one does. Arhivă
  // (archived) and OSUBB (the Organization Group) never count.
  // The members of every Group (#929): roster rows with their joining date,
  // Automatic Membership (Ana in the Adunarea Generală) and the membri de drept
  // (Bogdan, BC, in Educațional) -- the last never listed under a member.
  group_roster: [
    {
      member_id: 'a',
      group_id: 2,
      source: 'roster',
      joined_at: '2026-01-01T00:00:00Z',
    },
    {
      member_id: 'a',
      group_id: 1,
      source: 'roster',
      joined_at: '2026-02-01T00:00:00Z',
    },
    {
      member_id: 'a',
      group_id: 4,
      source: 'roster',
      joined_at: '2026-03-01T00:00:00Z',
    },
    {
      member_id: 'a',
      group_id: 3,
      source: 'roster',
      joined_at: '2026-01-15T00:00:00Z',
    },
    { member_id: 'a', group_id: 9, source: 'automatic', joined_at: null },
    { member_id: 'a', group_id: 5, source: 'automatic', joined_at: null },
    { member_id: 'b', group_id: 1, source: 'board', joined_at: null },
  ],
  groups: [
    {
      id: 1,
      name: 'Educațional',
      category: 'department',
      path: [1],
      status: 'active',
      is_organization: false,
      parent_id: null,
      color: '#111111',
    },
    {
      id: 2,
      name: 'Logistică',
      category: 'team',
      path: [1, 2],
      status: 'active',
      is_organization: false,
      parent_id: 1,
      color: '#222222',
    },
    {
      id: 3,
      name: 'Arhivă',
      category: 'team',
      path: [1, 3],
      status: 'archived',
      is_organization: false,
      parent_id: 1,
      color: '#333333',
    },
    {
      id: 4,
      name: 'Imagine & PR',
      category: 'department',
      path: [4],
      status: 'active',
      is_organization: false,
      parent_id: null,
      color: '#444444',
    },
    {
      id: 5,
      name: 'Adunarea Generală',
      category: 'team',
      path: [5],
      status: 'active',
      is_organization: false,
      parent_id: null,
      color: '#555555',
    },
    {
      id: 9,
      name: 'OSUBB',
      category: 'organization',
      path: [9],
      status: 'active',
      is_organization: true,
      parent_id: null,
      color: null,
    },
  ],
  roles: [
    { id: 'voluntar', name: 'Voluntar', level: 1 },
    { id: 'bc', name: 'BC', level: 6 },
  ],
};
function query(data: unknown[] | null, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) =>
      Promise.resolve({ data: data?.slice(from, to + 1) ?? null, error }),
    ),
  };
  return builder;
}
/** The group_roster read answers from the fixture; any other rpc is the ranking. */
function rpcWith(ranking: () => ReturnType<typeof query>) {
  return (name: string) =>
    name === 'group_roster' ? query(fixtures.group_roster ?? []) : ranking();
}
beforeEach(() => {
  mocks.from
    .mockReset()
    .mockImplementation((name: string) => query(fixtures[name] ?? []));
  mocks.rpc
    .mockReset()
    .mockImplementation(rpcWith(() => query([{ member_id: 'a', points: -3 }])));
});
describe('directory reads', () => {
  it('joins only authorized projections and leadership Task points without inventing contacts', async () => {
    const members = await fetchMemberDirectory();
    expect(members[0]).toMatchObject({
      name: 'Ana',
      role: 'Voluntar',
      roleId: 'voluntar',
      roleLevel: 1,
      // Archived Groups and the Organization Group are left out; the
      // Department comes before its team, which carries its parent's name.
      // The Adunarea Generală is listed by Automatic Membership (#929), so
      // the Grup filter finds Ana under it.
      groups: [
        { id: 5, label: 'Adunarea Generală', path: [5] },
        { id: 1, label: 'Educațional', path: [1] },
        { id: 4, label: 'Imagine & PR', path: [4] },
        { id: 2, label: 'Logistică · Educațional', path: [1, 2] },
      ],
      // The chip (R17): the earliest-joined TOP-LEVEL Group. Logistică joined
      // first of all three but is a child, so it never becomes the chip;
      // Educațional (top-level, joined next) does, ahead of the
      // later-joined Imagine & PR, which folds into "+n" alongside Logistică.
      // Automatic Membership has no joining date: never the chip, never "+n".
      primaryGroup: { id: 1, name: 'Educațional', color: '#111111' },
      otherMemberships: 2,
      points: -3,
      contact: { email: 'ana@example.test' },
    });
    expect(members[1]).toMatchObject({
      // Bogdan is BC: no points, not a fabricated 0 (ruling 1) -- and a
      // membru de drept of every Group, which no Grup filter lists (#929).
      points: null,
      contact: undefined,
      primaryGroup: null,
      otherMemberships: 0,
      groups: [],
    });
    expect(mocks.from).not.toHaveBeenCalledWith('profiles');
    expect(mocks.from).not.toHaveBeenCalledWith('group_members');
    expect(mocks.rpc).toHaveBeenCalledWith('group_roster', {});
    expect(mocks.rpc).toHaveBeenCalledWith('leadership_leaderboard', {});
  });
  it('surfaces a denied point read rather than displaying fabricated zero totals', async () => {
    const error = { code: '42501', message: 'denied' };
    mocks.rpc.mockImplementation(rpcWith(() => query(null, error)));
    await expect(fetchMemberDirectory()).rejects.toEqual(error);
  });
  it('reads subsequent membership and leaderboard pages before joining totals and filters', async () => {
    const memberships = Array.from({ length: 500 }, (_, index) => ({
      member_id: `other-${index}`,
      group_id: 1,
      source: 'roster',
      joined_at: '2026-01-01T00:00:00Z',
    }));
    const pages = query([
      ...memberships,
      {
        member_id: 'b',
        group_id: 2,
        source: 'roster',
        joined_at: '2026-01-01T00:00:00Z',
      },
    ]);
    const ranking = query([
      ...Array.from({ length: 500 }, (_, index) => ({
        member_id: `other-${index}`,
        points: 1,
      })),
      { member_id: 'a', points: 42 },
    ]);
    mocks.rpc.mockImplementation((name: string) =>
      name === 'group_roster' ? pages : ranking,
    );
    const members = await fetchMemberDirectory();
    expect(members[0]).toMatchObject({ points: 42 });
    expect(members[1]).toMatchObject({
      groups: [{ label: 'Logistică · Educațional' }],
    });
    expect(pages.range).toHaveBeenCalledWith(500, 999);
    expect(ranking.range).toHaveBeenCalledWith(500, 999);
  });
  it('shows no points for BCE, BC and the Moderator whatever the ranking returns (ruling 1, #907)', async () => {
    mocks.from.mockImplementation((name: string) =>
      name === 'profiles_directory'
        ? query([
            { id: 'bc', full_name: 'Cristina', role: 'bc', status: 'activ' },
            {
              id: 'mod',
              full_name: 'Mihai',
              role: 'moderator',
              status: 'activ',
            },
            { id: 'bce', full_name: 'Alex', role: 'bce', status: 'activ' },
            { id: 'v', full_name: 'Vlad', role: 'voluntar', status: 'activ' },
          ])
        : query(fixtures[name] ?? []),
    );
    mocks.rpc.mockImplementation(
      rpcWith(() =>
        query([
          { member_id: 'bc', points: 8 },
          { member_id: 'mod', points: 10 },
          { member_id: 'bce', points: 5 },
        ]),
      ),
    );
    const members = await fetchMemberDirectory();
    expect(members.map((member) => [member.id, member.points])).toEqual([
      ['bc', null],
      ['mod', null],
      ['bce', null],
      ['v', 0],
    ]);
  });
});
