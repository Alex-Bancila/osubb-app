import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseOrRefuse } from '../lib/form-errors';
import { reasonSchema } from '../lib/schemas/reason';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { reviewError } from './task-review';
export async function reopenTask(input: { taskId: number; reason: string }) {
  const { reason } = parseOrRefuse(
    reasonSchema,
    input,
    'Nu am putut redeschide taskul. Încearcă din nou.',
  );
  const { data, error } = await supabase.rpc('reopen_task', {
    p_task_id: input.taskId,
    p_reason: reason,
  });
  if (error)
    throw reviewError(error, {
      forbidden: 'Nu mai ai permisiunea de a redeschide acest task.',
      failed: 'Nu am putut redeschide taskul. Încearcă din nou.',
    });
  return data;
}
export function useReopenTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reopenTask,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]),
  });
}
