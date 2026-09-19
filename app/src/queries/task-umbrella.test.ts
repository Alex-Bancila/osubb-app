import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { completeUmbrella, createSubtask } from './task-umbrella';
import type { TaskDraft } from '../screens/tracker/task-form-model';
const draft: TaskDraft = {
  title: 'Copil',
  description: null,
  deadline: '2026-10-01T09:00:00Z',
  groupId: 3,
  kind: 'task',
  parentTaskId: 10,
  audience: 'org',
  assignmentMode: 'public',
  executorId: null,
  campaignId: null,
};

describe('Umbrella commands', () => {
  it('creates an ordinary child with the inherited Group through the command', async () => {
    rpc.mockResolvedValue({ data: { id: 27 }, error: null });
    expect(await createSubtask(draft)).toEqual({ id: 27 });
    expect(rpc).toHaveBeenCalledWith('create_task', {
      p_title: 'Copil',
      p_description: null,
      p_deadline: '2026-10-01T09:00:00Z',
      p_group_id: 3,
      p_dept_id: null,
      p_team_id: null,
      p_project_id: null,
      p_audience: 'org',
      p_assignment_mode: 'public',
      p_executor_id: null,
      p_campaign_id: null,
      p_parent_task_id: 10,
      p_kind: 'task',
    });
  });
  it('does not send an ordinary root draft to the Subtask command adapter', async () => {
    await expect(
      createSubtask({ ...draft, parentTaskId: null }),
    ).rejects.toThrow('Subtask required');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('completes using only the parent identifier and propagates errors for safe UI mapping', async () => {
    const error = { code: 'PT409', message: 'subtasks_not_terminal' };
    rpc.mockResolvedValue({ error, data: null });
    await expect(completeUmbrella(10)).rejects.toEqual(error);
    expect(rpc).toHaveBeenCalledWith('complete_umbrella_task', {
      p_task_id: 10,
    });
  });
});
