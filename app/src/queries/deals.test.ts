import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));

import { AnnouncementRefusedError } from './announcements';
import {
  createDeal,
  fetchDealRevealCount,
  fetchDeals,
  fetchDealsTeam,
  revealDealCode,
  setDealsTeamMember,
  updateDeal,
} from './deals';
import { setBcAssignment } from './bc-assignments';

beforeEach(() => resetSupabaseMock());

describe('fetchDeals (R45)', () => {
  it('reads Announcements of kind deal only, newest first, with my read and my reveal', async () => {
    supabaseMock.order.mockResolvedValue({ data: [{ id: 1 }], error: null });
    await expect(fetchDeals()).resolves.toEqual([{ id: 1 }]);
    expect(supabaseMock.from).toHaveBeenCalledWith('announcements');
    expect(supabaseMock.eq).toHaveBeenCalledWith('kind', 'deal');
    const fields = supabaseMock.select.mock.calls[0]?.[0] as string;
    for (const field of [
      'code',
      'links',
      'announcement_reads',
      'deal_code_reveals',
    ])
      expect(fields).toContain(field);
    expect(supabaseMock.order).toHaveBeenCalledWith('published_at', {
      ascending: false,
    });
  });
});

describe('createDeal', () => {
  it('fixes everything a Deal may not choose: the Organization, everyone, normal, never pinned', async () => {
    supabaseMock.insert.mockResolvedValue({ error: null });
    await createDeal({
      organizationGroupId: 1,
      title: 'Reducere',
      body: 'Detalii',
      deadline: null,
      links: [{ label: 'Magazin', url: 'https://example.ro' }],
      code: 'OSUBB20',
    });
    expect(supabaseMock.insert).toHaveBeenCalledWith({
      kind: 'deal',
      group_id: 1,
      audience: 'org',
      min_level: 0,
      priority: 'normal',
      pinned: false,
      title: 'Reducere',
      body: 'Detalii',
      deadline: null,
      links: [{ label: 'Magazin', url: 'https://example.ro' }],
      code: 'OSUBB20',
    });
    // No RETURNING, as for an Announcement.
    expect(supabaseMock.select).not.toHaveBeenCalled();
  });
});

describe('updateDeal', () => {
  it('sends only the changes, and a row RLS filtered out is a refusal', async () => {
    supabaseMock.select.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      updateDeal({ id: 3, changes: { code: null } }),
    ).rejects.toBeInstanceOf(AnnouncementRefusedError);
    expect(supabaseMock.update).toHaveBeenCalledWith({ code: null });
    expect(supabaseMock.eq).toHaveBeenCalledWith('id', 3);
  });
});

describe('the Deal Code', () => {
  it('reveals through the command, which records the reveal', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 'OSUBB20', error: null });
    await expect(revealDealCode(9)).resolves.toBe('OSUBB20');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reveal_deal_code', {
      p_announcement_id: 9,
    });
  });

  it('hides the count from someone not on the team instead of failing', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(fetchDealRevealCount(9)).resolves.toBeNull();
    supabaseMock.rpc.mockResolvedValue({ data: 4, error: null });
    await expect(fetchDealRevealCount(9)).resolves.toBe(4);
    expect(supabaseMock.rpc).toHaveBeenLastCalledWith(
      'deal_code_reveal_count',
      { p_announcement_id: 9 },
    );
  });
});

describe('the OSUBB Deals team (R44)', () => {
  it('reads the holder and both places from the live tables', async () => {
    supabaseMock.eq
      .mockResolvedValueOnce({ data: [{ member_id: 'holder' }], error: null })
      .mockResolvedValueOnce({
        data: [
          { team_role: 'responsible', member_id: 'resp' },
          { team_role: 'coordinator', member_id: 'coord' },
        ],
        error: null,
      });
    await expect(fetchDealsTeam()).resolves.toEqual({
      holderId: 'holder',
      coordinatorId: 'coord',
      responsibleId: 'resp',
    });
    expect(supabaseMock.from).toHaveBeenCalledWith('bc_assignments');
    expect(supabaseMock.from).toHaveBeenCalledWith('assignment_team');
    expect(supabaseMock.eq).toHaveBeenCalledWith('assignment', 'osubb_deals');
  });

  it('clears a place with a null member', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
    await setDealsTeamMember({ role: 'responsible', memberId: null });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'set_assignment_team_member',
      {
        p_assignment: 'osubb_deals',
        p_team_role: 'responsible',
        p_member_id: null,
      },
    );
  });

  it('gives, moves and takes back an Atribuție through one command', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
    await setBcAssignment({
      assignment: 'osubb_deals',
      memberId: 'bc',
      granted: true,
      move: true,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_bc_assignment', {
      p_assignment: 'osubb_deals',
      p_member_id: 'bc',
      p_granted: true,
      p_move: true,
    });
    await setBcAssignment({
      assignment: 'osubb_deals',
      memberId: 'bc',
      granted: false,
    });
    expect(supabaseMock.rpc).toHaveBeenLastCalledWith('set_bc_assignment', {
      p_assignment: 'osubb_deals',
      p_member_id: 'bc',
      p_granted: false,
      p_move: false,
    });
  });

  it('passes a refusal on with its reason', async () => {
    const refusal = { code: 'PT409', message: 'bc_assignment_held' };
    supabaseMock.rpc.mockResolvedValue({ data: null, error: refusal });
    await expect(
      setBcAssignment({
        assignment: 'osubb_deals',
        memberId: 'bc',
        granted: true,
      }),
    ).rejects.toBe(refusal);
  });
});
