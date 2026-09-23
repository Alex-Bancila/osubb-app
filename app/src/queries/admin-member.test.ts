import { beforeEach, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';
vi.mock('../lib/supabase', async () => ({
  supabase: (
    await vi.importActual<typeof import('../test/supabase-mock')>(
      '../test/supabase-mock',
    )
  ).supabaseClientMock,
}));
import {
  cardMemberships,
  fetchAdminMember,
  updateMemberIdentity,
} from './admin-member';
beforeEach(resetSupabaseMock);
it('reads the safe Member Card and uses RLS for contact and paginated ledger rows', async () => {
  const card = { member_id: 'member', memberships: [] };
  supabaseMock.rpc.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: card, error: null }),
  });
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'points_ledger') {
      const q = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        range: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      q.select.mockReturnValue(q);
      q.eq.mockReturnValue(q);
      q.order.mockReturnValue(q);
      return q;
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'profiles_directory' ? { status: 'activ' } : null,
            error: null,
          }),
        }),
      }),
    };
  });
  expect(await fetchAdminMember('member')).toEqual({
    card,
    memberships: [],
    status: 'activ',
    contact: null,
    points: [],
  });
  expect(supabaseMock.rpc).toHaveBeenCalledWith('member_card', {
    p_member_id: 'member',
  });
  expect(supabaseMock.from).toHaveBeenCalledWith('points_ledger');
});
it('updates only nickname/full name and checks that RLS returned the target row', async () => {
  const single = vi
    .fn()
    .mockResolvedValue({ data: { id: 'member' }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  supabaseMock.from.mockReturnValue({ update });
  await updateMemberIdentity({
    memberId: 'member',
    nickname: '  ',
    fullName: ' Ana Pop ',
  });
  expect(update).toHaveBeenCalledWith({ nickname: null, full_name: 'Ana Pop' });
  expect(eq).toHaveBeenCalledWith('id', 'member');
  expect(single).toHaveBeenCalled();
});
it('rejects malformed membership JSON', () => {
  expect(cardMemberships([null, { group_id: '1' }, 'bad'])).toEqual([]);
});
