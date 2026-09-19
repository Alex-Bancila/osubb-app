import { QueryClient } from '@tanstack/react-query';
import { keys } from './keys';
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  completeUmbrella,
  createSubtask,
  createSubtaskMutationOptions,
  umbrellaCompletionErrorMessage,
} from './task-umbrella';
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

it.each([
  ['task_command_forbidden', 'Nu ai permisiunea'],
  ['task_manage_forbidden', 'Nu ai permisiunea'],
  ['task_not_found', 'nu mai este disponibil'],
  ['task_not_umbrella', 'nu este un task-umbrelă'],
  ['task_terminal', 'deja finalizat'],
  ['umbrella_has_no_subtasks', 'cel puțin un subtask'],
  ['subtasks_not_terminal', 'Starea subtaskurilor s-a schimbat'],
])('maps stable completion reason %s without SQLSTATE', (message, expected) => {
  expect(umbrellaCompletionErrorMessage({ message })).toContain(expected);
  expect(
    umbrellaCompletionErrorMessage({ message, code: 'unknown' }),
  ).toContain(expected);
});
it('does not classify or expose unknown completion payloads', () => {
  expect(
    umbrellaCompletionErrorMessage({ code: '42501', message: 'secret SQL' }),
  ).toBe('Nu am putut finaliza taskul-umbrelă. Reîncearcă.');
});
it('refreshes Task reads even when Subtask creation is denied', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const failure = { message: 'task_manage_forbidden' };
  rpc.mockResolvedValue({ data: null, error: failure });
  const mutation = client
    .getMutationCache()
    .build(client, createSubtaskMutationOptions(client));
  await expect(mutation.execute(draft)).rejects.toEqual(failure);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all });
});
