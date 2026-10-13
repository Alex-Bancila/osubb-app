import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';
import type { TaskDraft } from '../screens/tracker/task-form-model';

/**
 * The one `create_task` caller: a top-level Task, an Umbrella, or a Subtask
 * (a draft with `parentTaskId`). Named arguments only; the Group is the only
 * Origin (#579) — a Subtask sends none and inherits its Umbrella's.
 */
export async function createTask(draft: TaskDraft) {
  if (draft.kind === 'umbrella' && draft.parentTaskId !== null)
    throw new Error('An Umbrella cannot be a Subtask');
  const args = {
    p_group_id: draft.groupId,
    p_kind: draft.kind,
    p_parent_task_id: draft.parentTaskId,
    p_executor_id: draft.executorId,
    p_campaign_id: draft.campaignId,
    p_audience: draft.audience,
    p_assignment_mode: draft.assignmentMode,
    p_title: draft.title,
    p_description: draft.description,
    p_deadline: draft.deadline,
    // R46: the Attached Links, complete rows only (none is `[]`).
    p_links: draft.links,
  };
  // PostgreSQL accepts NULL for the optional values (an Umbrella has no mode,
  // audience, Executor or Campaign). Generated RPC argument types omit
  // nullability; isolate that mismatch here.
  const { data, error } = await supabase.rpc(
    'create_task',
    args as unknown as Database['public']['Functions']['create_task']['Args'],
  );
  if (error) throw error;
  return data;
}

export async function completeUmbrella(taskId: number) {
  const { data, error } = await supabase.rpc('complete_umbrella_task', {
    p_task_id: taskId,
  });
  if (error) throw error;
  return data;
}

export function createTaskMutationOptions(client: QueryClient) {
  return {
    mutationFn: createTask,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useCreateTask() {
  const client = useQueryClient();
  return useMutation(createTaskMutationOptions(client));
}
export function useCompleteUmbrella() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: completeUmbrella,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}

/** What the Tracker sends `create_tasks`: the draft, plus the dialog's Executors for n direct copies. */
export type CreateTasksInput = {
  draft: TaskDraft;
  /** One Executor per copy, from the executors dialog; only for direct copies above one. */
  executorIds?: readonly string[];
};

/**
 * `create_tasks`' arguments (spec 2026-10-11): a single direct Task sends its
 * one Executor as a one-entry list, n direct copies send the dialog's list,
 * anything public or an Umbrella sends none.
 */
export function createTasksArgs({ draft, executorIds }: CreateTasksInput) {
  const direct = draft.assignmentMode === 'direct';
  const executors = !direct
    ? null
    : draft.copies > 1
      ? [...(executorIds ?? [])]
      : draft.executorId
        ? [draft.executorId]
        : null;
  return {
    p_group_id: draft.groupId,
    p_kind: draft.kind,
    p_parent_task_id: draft.parentTaskId,
    p_executor_ids: executors,
    p_campaign_id: draft.campaignId,
    p_audience: draft.audience,
    p_assignment_mode: draft.assignmentMode,
    p_title: draft.title,
    p_description: draft.description,
    p_deadline: draft.deadline,
    p_links: draft.links,
    p_copies: draft.copies,
  };
}

/** The Tracker's one create path: n copies (n = 1 included) in one transaction. */
export async function createTasks(input: CreateTasksInput) {
  if (input.draft.kind === 'umbrella' && input.draft.parentTaskId !== null)
    throw new Error('An Umbrella cannot be a Subtask');
  const { data, error } = await supabase.rpc(
    'create_tasks',
    createTasksArgs(
      input,
    ) as unknown as Database['public']['Functions']['create_tasks']['Args'],
  );
  if (error) throw error;
  return data;
}

export function useCreateTasks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createTasks,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
