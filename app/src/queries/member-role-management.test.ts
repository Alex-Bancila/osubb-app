import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { changeMember, fetchMemberGroupIds } from './member-role-management';

beforeEach(() => {
  api.rpc
    .mockReset()
    .mockResolvedValue({ data: { id: 'member' }, error: null });
});

it('sends Drept de Vot confirmation and withdrawal through audited Role command', async () => {
  await changeMember({
    kind: 'role',
    memberId: 'member',
    role: 'vot',
    reason: 'Confirmat de BC',
  });
  expect(api.rpc).toHaveBeenLastCalledWith('set_member_role', {
    p_member_id: 'member',
    p_role: 'vot',
    p_reason: 'Confirmat de BC',
  });
  await changeMember({
    kind: 'role',
    memberId: 'member',
    role: 'voluntar',
    reason: null,
  });
  expect(api.rpc).toHaveBeenLastCalledWith('set_member_role', {
    p_member_id: 'member',
    p_role: 'voluntar',
    p_reason: undefined,
  });
  expect(Object.keys(api.rpc.mock.calls[0]?.[1] ?? {})).not.toContain(
    'p_actor',
  );
});

it('deactivates through the atomic Status command that revokes refresh sessions', async () => {
  await changeMember({
    kind: 'status',
    memberId: 'member',
    status: 'inactiv',
    reason: 'Părăsire',
  });
  expect(api.rpc).toHaveBeenCalledExactlyOnceWith('set_member_status', {
    p_member_id: 'member',
    p_status: 'inactiv',
    p_reason: 'Părăsire',
  });
});

it('reads every page of explicit Group memberships for departure preview', async () => {
  const range = vi.fn().mockImplementation((from: number) =>
    Promise.resolve({
      data:
        from === 0
          ? Array.from({ length: 500 }, (_, index) => ({ group_id: index + 1 }))
          : [{ group_id: 501 }],
      error: null,
    }),
  );
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range,
  };
  api.from.mockReturnValue(builder);
  const result = await fetchMemberGroupIds('member');
  expect(result.size).toBe(501);
  expect(result.has(501)).toBe(true);
  expect(range).toHaveBeenCalledTimes(2);
  expect(api.from).toHaveBeenCalledWith('group_members');
});
