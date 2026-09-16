import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { progressTask, taskProgressMutationOptions } from './task-progress';
import { keys } from './keys';

describe('Task card progress commands', () => {
  it.each(['start', 'submit'] as const)(
    'uses the %s command with only the Task id',
    async (action) => {
      rpc.mockResolvedValue({ error: null });
      await progressTask({ taskId: 4, action });
      expect(rpc).toHaveBeenLastCalledWith(
        action === 'start' ? 'start_task' : 'submit_task_for_review',
        { p_task_id: 4 },
      );
    },
  );

  it.each(['PT409', 'PT404', '42501'])(
    'gives safe feedback for %s',
    async (code) => {
      rpc.mockResolvedValue({
        error: { code, message: 'private database details' },
      });
      await expect(
        progressTask({ taskId: 4, action: 'start' }),
      ).rejects.toThrow('Taskul s-a schimbat');
    },
  );

  it('uses a retryable message for network or unknown failures', async () => {
    rpc.mockResolvedValue({ error: { code: '', message: 'Failed to fetch' } });
    await expect(progressTask({ taskId: 4, action: 'start' })).rejects.toThrow(
      'Încearcă din nou.',
    );
  });

  it('refreshes the entire Task query family on success or failure', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await taskProgressMutationOptions(client).onSettled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all });
  });
});
