import { QueryClient } from '@tanstack/react-query';
import { keys } from './keys';
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  completeUmbrella,
  createTask,
  createTaskMutationOptions,
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
    expect(await createTask(draft)).toEqual({ id: 27 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_task', {
      p_title: 'Copil',
      p_description: null,
      p_deadline: '2026-10-01T09:00:00Z',
      p_group_id: 3,
      p_audience: 'org',
      p_assignment_mode: 'public',
      p_executor_id: null,
      p_campaign_id: null,
      p_parent_task_id: 10,
      p_kind: 'task',
    });
  });
  it('creates a top-level direct Task with its Executor and Campaign', async () => {
    rpc.mockResolvedValue({ data: { id: 28 }, error: null });
    await createTask({
      ...draft,
      parentTaskId: null,
      assignmentMode: 'direct',
      audience: 'local',
      executorId: 'executor-1',
      campaignId: 5,
    });
    expect(rpc).toHaveBeenCalledWith('create_task', {
      p_title: 'Copil',
      p_description: null,
      p_deadline: '2026-10-01T09:00:00Z',
      p_group_id: 3,
      p_audience: 'local',
      p_assignment_mode: 'direct',
      p_executor_id: 'executor-1',
      p_campaign_id: 5,
      p_parent_task_id: null,
      p_kind: 'task',
    });
  });
  it('creates an Umbrella with no mode, audience, Executor or Campaign', async () => {
    rpc.mockResolvedValue({ data: { id: 29 }, error: null });
    await createTask({
      ...draft,
      kind: 'umbrella',
      parentTaskId: null,
      deadline: null,
      audience: null,
      assignmentMode: null,
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).toMatchObject({
      p_kind: 'umbrella',
      p_group_id: 3,
      p_audience: null,
      p_assignment_mode: null,
      p_parent_task_id: null,
    });
  });
  it('never sends the retired legacy Origin arguments (#579)', async () => {
    rpc.mockResolvedValue({ data: { id: 30 }, error: null });
    await createTask({ ...draft, parentTaskId: null });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).not.toHaveProperty('p_dept_id');
    expect(args).not.toHaveProperty('p_team_id');
    expect(args).not.toHaveProperty('p_project_id');
  });
  it('does not send an Umbrella draft with a parent to the command', async () => {
    await expect(createTask({ ...draft, kind: 'umbrella' })).rejects.toThrow(
      'An Umbrella cannot be a Subtask',
    );
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
    .build(client, createTaskMutationOptions(client));
  await expect(mutation.execute(draft)).rejects.toEqual(failure);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all });
});
