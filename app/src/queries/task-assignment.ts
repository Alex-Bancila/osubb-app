import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { CommandError } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
/** A refused assignment, in the shared copy of `command-reasons.ts`. */
export class TaskAssignmentError extends CommandError {}
export async function assignTaskExecutor({
  taskId,
  memberId,
}: {
  taskId: number;
  memberId: string;
}) {
  const { data, error } = await supabase.rpc('assign_task_executor', {
    p_task_id: taskId,
    p_member_id: memberId,
  });
  if (error)
    throw new TaskAssignmentError(
      error,
      'Nu am putut atribui taskul. Încearcă din nou.',
    );
  return data;
}
export function taskAssignmentOptions(client: QueryClient) {
  return {
    mutationFn: assignTaskExecutor,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useTaskAssignment() {
  return useMutation(taskAssignmentOptions(useQueryClient()));
}
