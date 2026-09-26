import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

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
