import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  fetchGroupCoordination,
  runApplicationCommand,
} from './group-applications';
beforeEach(() =>
  rpc.mockResolvedValue({ data: { id: 7, status: 'pending' }, error: null }),
);
it('applies with a trimmed optional note and no spoofable actor', async () => {
  await runApplicationCommand({
    kind: 'apply',
    groupId: 3,
    note: '  Vreau să ajut  ',
  });
  expect(rpc).toHaveBeenCalledWith('apply_to_group', {
    p_group_id: 3,
    p_note: 'Vreau să ajut',
  });
});
it('omits a blank note', async () => {
  await runApplicationCommand({ kind: 'apply', groupId: 3, note: '  ' });
  expect(rpc).toHaveBeenCalledWith('apply_to_group', { p_group_id: 3 });
});
it('withdraws the server Application id', async () => {
  await runApplicationCommand({ kind: 'withdraw', applicationId: 7 });
  expect(rpc).toHaveBeenCalledWith('withdraw_group_application', {
    p_application_id: 7,
  });
});
it.each([true, false])(
  'submits the decision %s and separate decision note',
  async (accept) => {
    await runApplicationCommand({
      kind: 'decide',
      applicationId: 7,
      accept,
      note: '  Mulțumim  ',
    });
    expect(rpc).toHaveBeenCalledWith('decide_group_application', {
      p_application_id: 7,
      p_accept: accept,
      p_note: 'Mulțumim',
    });
  },
);
it.each([
  [
    'group_not_accepting_applications',
    'Acest grup nu primește cereri de înscriere.',
  ],
  ['application_not_pending', 'Cererea a fost deja soluționată.'],
  ['application_withdraw_forbidden', 'Poți retrage doar propria cerere.'],
])('translates %s through the shared table', async (message, copy) => {
  rpc.mockResolvedValue({ data: null, error: { message, code: 'PT409' } });
  await expect(
    runApplicationCommand({ kind: 'withdraw', applicationId: 7 }),
  ).rejects.toThrow(copy);
});

it('reads coordinator identities for MemberName (Nickname and full name)', async () => {
  rpc.mockResolvedValue({
    data: [
      {
        member_id: 'a',
        full_name: 'Full name',
        nickname: 'Nickname',
        group_role: 'manager',
        position_title: null,
      },
      {
        member_id: 'b',
        full_name: 'Second name',
        nickname: null,
        group_role: 'responsible',
        position_title: 'Editor',
      },
    ],
    error: null,
  });
  await expect(fetchGroupCoordination(3)).resolves.toEqual([
    {
      memberId: 'a',
      fullName: 'Full name',
      nickname: 'Nickname',
      groupRole: 'manager',
      positionTitle: null,
    },
    {
      memberId: 'b',
      fullName: 'Second name',
      nickname: null,
      groupRole: 'responsible',
      positionTitle: 'Editor',
    },
  ]);
  expect(rpc).toHaveBeenCalledWith('group_coordination', { p_group_id: 3 });
});
it('reports a failed coordination read rather than displaying an empty list', async () => {
  const error = { message: 'unavailable' };
  rpc.mockResolvedValue({ data: null, error });
  await expect(fetchGroupCoordination(3)).rejects.toEqual(error);
});
