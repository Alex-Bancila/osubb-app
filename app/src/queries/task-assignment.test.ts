import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { assignTaskExecutor, taskAssignmentOptions } from './task-assignment';
it('sends only the target Task and selected Member to the command', async () => {
  rpc.mockResolvedValue({ data: { id: 7 }, error: null });
  await assignTaskExecutor({ taskId: 7, memberId: 'member' });
  expect(rpc).toHaveBeenLastCalledWith('assign_task_executor', {
    p_task_id: 7,
    p_member_id: 'member',
  });
});
it.each(['PT400', 'PT404', 'PT409', '42501', 'XX000'])(
  'maps %s to safe copy and refreshes after decisions',
  async (code) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: 'private SQL detail' },
    });
    await expect(
      assignTaskExecutor({ taskId: 7, memberId: 'member' }),
    ).rejects.not.toThrow('private SQL detail');
    const client = new QueryClient();
    const refresh = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    await taskAssignmentOptions(client).onSettled();
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  },
);

it('uses the stable reason even if its SQL code changes', async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: 'P0001', message: 'invalid_executor' },
  });
  await expect(
    assignTaskExecutor({ taskId: 7, memberId: 'member' }),
  ).rejects.toThrow('Membrul nu mai este eligibil');
});
