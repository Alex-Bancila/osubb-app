import { QueryClient } from '@tanstack/react-query';
import { keys } from './keys';
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  completeUmbrella,
  createTask,
  createTaskMutationOptions,
  createTasks,
  createTasksArgs,
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
  links: [],
  copies: 1,
  minLevel: 1,
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
      p_links: [],
      p_min_level: 1,
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
      links: [{ label: 'Brief', url: 'https://example.org/brief' }],
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
      p_links: [{ label: 'Brief', url: 'https://example.org/brief' }],
      p_min_level: 1,
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

describe('create_tasks arguments', () => {
  it('sends one Executor as a one-entry list for a single direct Task', () => {
    expect(
      createTasksArgs({
        draft: {
          ...draft,
          parentTaskId: null,
          assignmentMode: 'direct',
          audience: 'local',
          executorId: 'executor-1',
        },
      }),
    ).toMatchObject({ p_executor_ids: ['executor-1'], p_copies: 1 });
  });
  it("sends the dialog's Executors, one per copy, for n direct copies", () => {
    expect(
      createTasksArgs({
        draft: {
          ...draft,
          assignmentMode: 'direct',
          audience: 'local',
          copies: 3,
        },
        executorIds: ['a', 'b', 'c'],
      }),
    ).toMatchObject({ p_executor_ids: ['a', 'b', 'c'], p_copies: 3 });
  });
  it('sends no Executors for public copies, whatever the form held', () => {
    expect(
      createTasksArgs({ draft: { ...draft, copies: 4, executorId: 'stale' } }),
    ).toMatchObject({
      p_executor_ids: null,
      p_copies: 4,
      p_assignment_mode: 'public',
    });
  });
  it('calls create_tasks and returns the rows', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    await expect(
      createTasks({ draft: { ...draft, copies: 2 } }),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(rpc).toHaveBeenLastCalledWith(
      'create_tasks',
      expect.objectContaining({ p_copies: 2, p_executor_ids: null }),
    );
  });
});
