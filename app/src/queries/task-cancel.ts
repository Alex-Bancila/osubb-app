import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { reviewError } from './task-review';
export async function cancelTask(input: { taskId: number; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Scrie motivul anulării.');
  const { data, error } = await supabase.rpc('cancel_task', {
    p_task_id: input.taskId,
    p_reason: reason,
  });
  if (error) throw reviewError(error.code);
  return data;
}
export function useCancelTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: cancelTask,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]),
  });
}
