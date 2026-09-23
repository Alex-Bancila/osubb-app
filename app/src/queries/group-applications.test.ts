import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { runApplicationCommand } from './group-applications';
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
