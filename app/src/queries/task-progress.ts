import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskProgressAction = 'start' | 'submit';
export type TaskProgressInput = { taskId: number; action: TaskProgressAction };

/** Only server commands change lifecycle state; the server derives the actor. */
export async function progressTask({
  taskId,
  action,
}: TaskProgressInput): Promise<void> {
  const { error } = await supabase.rpc(
    action === 'start' ? 'start_task' : 'submit_task_for_review',
    { p_task_id: taskId },
  );
  if (!error) return;
  if (['PT409', 'PT404', '42501'].includes(error.code)) {
    throw new Error(
      'Taskul s-a schimbat sau nu mai poți face această acțiune. Lista a fost actualizată.',
    );
  }
  throw new Error('Nu am putut salva schimbarea. Încearcă din nou.');
}

export function taskProgressMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: progressTask,
    // A conflict also requires a refresh. Never optimistically change Task state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}

export function useTaskProgress() {
  return useMutation(taskProgressMutationOptions(useQueryClient()));
}
