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
  group_members: [
    { member_id: 'a', group_id: 1 },
    { member_id: 'a', group_id: 2 },
  ],
  groups: [
    { id: 1, name: 'Educațional', category: 'department' },
    { id: 2, name: 'Logistică', category: 'team' },
  ],
  roles: [
    { id: 'voluntar', name: 'Voluntar' },
    { id: 'bc', name: 'BC' },
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
beforeEach(() => {
  mocks.from
    .mockReset()
    .mockImplementation((name: string) => query(fixtures[name]));
  mocks.rpc
    .mockReset()
    .mockImplementation(() => query([{ member_id: 'a', points: -3 }]));
});
describe('directory reads', () => {
  it('joins only authorized projections and leadership Task points without inventing contacts', async () => {
    const members = await fetchMemberDirectory();
    expect(members[0]).toMatchObject({
      name: 'Ana',
      role: 'Voluntar',
      departments: ['Educațional'],
      teams: ['Logistică'],
      points: -3,
      contact: { email: 'ana@example.test' },
    });
    expect(members[1]).toMatchObject({ points: 0, contact: undefined });
    expect(mocks.from).not.toHaveBeenCalledWith('profiles');
    expect(mocks.rpc).toHaveBeenCalledWith('leadership_leaderboard', {});
  });
  it('surfaces a denied point read rather than displaying fabricated zero totals', async () => {
    const error = { code: '42501', message: 'denied' };
    mocks.rpc.mockReturnValue(query(null, error));
    await expect(fetchMemberDirectory()).rejects.toEqual(error);
  });
  it('reads subsequent membership and leaderboard pages before joining totals and filters', async () => {
    const memberships = Array.from({ length: 500 }, (_, index) => ({
      member_id: `other-${index}`,
      group_id: 1,
    }));
    const pages = query([...memberships, { member_id: 'b', group_id: 2 }]);
    mocks.from.mockImplementation((name: string) =>
      name === 'group_members' ? pages : query(fixtures[name]),
    );
    const ranking = query([
      ...Array.from({ length: 500 }, (_, index) => ({
        member_id: `other-${index}`,
        points: 1,
      })),
      { member_id: 'b', points: 42 },
    ]);
    mocks.rpc.mockReturnValue(ranking);
    const members = await fetchMemberDirectory();
    expect(members[1]).toMatchObject({ teams: ['Logistică'], points: 42 });
    expect(pages.range).toHaveBeenCalledWith(500, 999);
    expect(ranking.range).toHaveBeenCalledWith(500, 999);
  });
});
