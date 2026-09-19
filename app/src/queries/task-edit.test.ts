import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { updateTaskContent } from './task-edit';
it('sends full replacement values, including explicit NULL clears, only to the command', async () => {
  api.rpc.mockResolvedValue({ data: { id: 1 }, error: null });
  await updateTaskContent({
    taskId: 1,
    title: ' Titlu ',
    description: ' ',
    deadline: null,
    campaignId: null,
  });
  expect(api.rpc).toHaveBeenCalledWith('update_task_content', {
    p_task_id: 1,
    p_title: 'Titlu',
    p_description: null,
    p_deadline: null,
    p_campaign_id: null,
  });
});
it('maps conflict and permission errors without backend details', async () => {
  api.rpc.mockResolvedValue({
    error: { code: 'PT409', message: 'task_terminal' },
  });
  await expect(
    updateTaskContent({
      taskId: 1,
      title: 'T',
      description: null,
      deadline: null,
      campaignId: null,
    }),
  ).rejects.toThrow('Taskul s-a schimbat');
  api.rpc.mockResolvedValue({
    error: { code: '42501', message: 'private SQL' },
  });
  await expect(
    updateTaskContent({
      taskId: 1,
      title: 'T',
      description: null,
      deadline: null,
      campaignId: null,
    }),
  ).rejects.toThrow('Nu mai ai permisiunea de a edita');
});
