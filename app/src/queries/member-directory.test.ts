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
beforeEach(() => {
  mocks.from.mockReset().mockImplementation((name: string) => {
    const response = { data: fixtures[name], error: null };
    return {
      select: vi
        .fn()
        .mockReturnValue({
          ...response,
          order: vi.fn().mockResolvedValue(response),
        }),
    };
  });
  mocks.rpc
    .mockReset()
    .mockResolvedValue({ data: [{ member_id: 'a', points: -3 }], error: null });
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
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(fetchMemberDirectory()).rejects.toEqual(error);
  });
});
