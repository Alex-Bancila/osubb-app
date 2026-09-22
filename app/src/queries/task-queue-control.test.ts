import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { setTaskQueue, taskQueueControlOptions } from './task-queue-control';
it.each([true, false])('uses the server command with open=%s', async (open) => {
  rpc.mockResolvedValue({ error: null });
  await setTaskQueue({ taskId: 17, open });
  expect(rpc).toHaveBeenLastCalledWith('set_task_queue', {
    p_task_id: 17,
    p_open: open,
  });
});
it.each([
  ['PT409', 'Coada s-a schimbat'],
  ['42501', 'Nu ai permisiunea'],
  ['XX000', 'Nu am putut modifica'],
])('maps %s safely', async (code, message) => {
  rpc.mockResolvedValue({ error: { code, message: 'private SQL' } });
  await expect(setTaskQueue({ taskId: 17, open: false })).rejects.toThrow(
    message,
  );
});
it('refreshes opportunities and participant data with one family invalidation', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  await taskQueueControlOptions(client).onSettled();
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['tasks'] });
});
