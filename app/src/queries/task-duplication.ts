import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export function taskDuplicationErrorMessage(error: unknown): string {
  const reason =
    typeof error === 'object' && error !== null && 'message' in error
      ? error.message
      : undefined;
  if (reason === 'deadline_required') return 'Alege un termen-limită valid.';
  if (reason === 'task_not_found')
    return 'Taskul sursă nu mai este disponibil.';
  if (reason === 'task_is_umbrella')
    return 'Acest task nu poate fi duplicat. Reîncarcă detaliile.';
  if (reason === 'task_command_forbidden' || reason === 'task_manage_forbidden')
    return 'Nu ai permisiunea să duplici acest task.';
  return 'Nu am putut duplica taskul. Încearcă din nou.';
}

export async function duplicateTask({
  taskId,
  deadline,
}: {
  taskId: number;
  deadline: string;
}) {
  const { data, error } = await supabase.rpc('duplicate_task', {
    p_task_id: taskId,
    p_deadline: deadline,
  });
  if (error) throw error;
  return data;
}

export function taskDuplicationMutationOptions(client: QueryClient) {
  return {
    mutationFn: duplicateTask,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useDuplicateTask() {
  const client = useQueryClient();
  return useMutation(taskDuplicationMutationOptions(client));
}
