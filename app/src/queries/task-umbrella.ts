import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';
import type { TaskDraft } from '../screens/tracker/task-form-model';

export async function createSubtask(draft: TaskDraft) {
  if (draft.kind !== 'task' || draft.parentTaskId === null)
    throw new Error('Subtask required');
  const args = {
    p_title: draft.title,
    p_description: draft.description,
    p_deadline: draft.deadline,
    p_dept_id: null,
    p_team_id: null,
    p_project_id: null,
    p_group_id: draft.groupId,
    p_audience: draft.audience,
    p_assignment_mode: draft.assignmentMode,
    p_executor_id: draft.executorId,
    p_campaign_id: draft.campaignId,
    p_parent_task_id: draft.parentTaskId,
    p_kind: 'task',
  };
  // PostgreSQL accepts NULL for optional values and the retired Origin columns.
  // Generated RPC argument types omit nullability; isolate that mismatch here.
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

const completionReasons: Record<string, string> = {
  task_command_forbidden: 'Nu ai permisiunea să finalizezi acest task-umbrelă.',
  task_manage_forbidden: 'Nu ai permisiunea să finalizezi acest task-umbrelă.',
  task_not_found: 'Taskul-umbrelă nu mai este disponibil.',
  task_not_umbrella: 'Taskul ales nu este un task-umbrelă.',
  task_terminal: 'Taskul-umbrelă este deja finalizat sau anulat.',
  umbrella_has_no_subtasks:
    'Adaugă cel puțin un subtask înainte de finalizare.',
  subtasks_not_terminal:
    'Starea subtaskurilor s-a schimbat. Verifică lista actualizată.',
};
export function umbrellaCompletionErrorMessage(error: unknown): string {
  const fallback = 'Nu am putut finaliza taskul-umbrelă. Reîncearcă.';
  const reason =
    typeof error === 'object' && error !== null && 'message' in error
      ? error.message
      : undefined;
  return typeof reason === 'string' && Object.hasOwn(completionReasons, reason)
    ? (completionReasons[reason] ?? fallback)
    : fallback;
}
export function createSubtaskMutationOptions(client: QueryClient) {
  return {
    mutationFn: createSubtask,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useCreateSubtask() {
  const client = useQueryClient();
  return useMutation(createSubtaskMutationOptions(client));
}
export function useCompleteUmbrella() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: completeUmbrella,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
