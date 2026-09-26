import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { CommandError } from '../lib/command-reasons';
import { progressTask, taskProgressMutationOptions } from './task-progress';
import { keys } from './keys';

describe('Task card progress commands', () => {
  it('starts a Task with only its id', async () => {
    rpc.mockResolvedValue({ error: null });
    await progressTask({ taskId: 4, action: 'start' });
    expect(rpc).toHaveBeenLastCalledWith('start_task', { p_task_id: 4 });
  });

  it('submits with nulls when there is no Submission Note or link', async () => {
    rpc.mockResolvedValue({ error: null });
    await progressTask({ taskId: 4, action: 'submit' });
    expect(rpc).toHaveBeenLastCalledWith('submit_task_for_review', {
      p_task_id: 4,
      p_note: null,
      p_link_label: null,
      p_link_url: null,
    });
  });

  it('sends the Submission Note and its Attached Link to the command', async () => {
    rpc.mockResolvedValue({ error: null });
    await progressTask({
      taskId: 4,
      action: 'submit',
      note: 'Am atașat afișul final.',
      linkLabel: 'Afiș',
      linkUrl: 'https://drive.example/afis',
    });
    expect(rpc).toHaveBeenLastCalledWith('submit_task_for_review', {
      p_task_id: 4,
      p_note: 'Am atașat afișul final.',
      p_link_label: 'Afiș',
      p_link_url: 'https://drive.example/afis',
    });
  });

  it('keeps a malformed-input reason so the dialog can place it', async () => {
    rpc.mockResolvedValue({
      error: { code: 'PT400', message: 'link_incomplete' },
    });
    const failure = await progressTask({ taskId: 4, action: 'submit' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CommandError);
    expect((failure as CommandError).reason).toBe('link_incomplete');
    expect((failure as CommandError).message).not.toMatch(/_/);
  });

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
