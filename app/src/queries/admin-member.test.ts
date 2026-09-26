import { beforeEach, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';
vi.mock('../lib/supabase', async () => ({
  supabase: (
    await vi.importActual<typeof import('../test/supabase-mock')>(
      '../test/supabase-mock',
    )
  ).supabaseClientMock,
}));
import { fetchAdminMember, updateMemberIdentity } from './admin-member';

beforeEach(resetSupabaseMock);

function chain(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ['select', 'eq', 'order'])
    query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.range = vi.fn().mockResolvedValue(result);
  return query;
}

it('reads the Member Card, the status and only the ledger rows RLS returns', async () => {
  const card = { member_id: 'member', memberships: [] };
  const ledger = [
    { id: 1, delta: 5, reason: 'task', created_at: 'x', task_id: 30 },
  ];
  supabaseMock.rpc.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
  });
  const tables = {
    profiles_contact: chain({ data: null, error: null }),
    profiles_directory: chain({ data: { status: 'activ' }, error: null }),
    points_ledger: chain({ data: ledger, error: null }),
  };
  supabaseMock.from.mockImplementation(
    (table: string) => tables[table as keyof typeof tables],
  );

  expect(await fetchAdminMember('member')).toEqual({
    card,
    contact: null,
    status: 'activ',
    points: ledger,
  });
  expect(supabaseMock.rpc).toHaveBeenCalledWith('member_card', {
    p_member_id: 'member',
  });
  expect(tables.points_ledger.eq).toHaveBeenCalledWith('member_id', 'member');
  expect(tables.profiles_directory.eq).toHaveBeenCalledWith('id', 'member');
});

it('surfaces a refused status read instead of an empty page', async () => {
  supabaseMock.rpc.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const refused = { message: 'permission denied' };
  const tables = {
    profiles_contact: chain({ data: null, error: null }),
    profiles_directory: chain({ data: null, error: refused }),
    points_ledger: chain({ data: [], error: null }),
  };
  supabaseMock.from.mockImplementation(
    (table: string) => tables[table as keyof typeof tables],
  );
  await expect(fetchAdminMember('member')).rejects.toBe(refused);
});

it('writes only the two names and requires the updated row back', async () => {
  const single = vi
    .fn()
    .mockResolvedValue({ data: { id: 'member' }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  supabaseMock.from.mockReturnValue({ update });
  await updateMemberIdentity({
    memberId: 'member',
    nickname: null,
    fullName: 'Ana Pop',
  });
  expect(supabaseMock.from).toHaveBeenCalledWith('profiles');
  expect(update).toHaveBeenCalledWith({ nickname: null, full_name: 'Ana Pop' });
  expect(eq).toHaveBeenCalledWith('id', 'member');
  expect(select).toHaveBeenCalledWith('id');
  expect(single).toHaveBeenCalled();
});

it('fails when RLS returns no row, so a refusal never reads as saved', async () => {
  const refused = { code: 'PGRST116', message: 'no rows' };
  const single = vi.fn().mockResolvedValue({ data: null, error: refused });
  supabaseMock.from.mockReturnValue({
    update: () => ({ eq: () => ({ select: () => ({ single }) }) }),
  });
  await expect(
    updateMemberIdentity({ memberId: 'm', nickname: null, fullName: 'A B' }),
  ).rejects.toBe(refused);
});
