import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { reviewError } from './task-review';

export async function returnTaskToProgress(input: {
  taskId: number;
  note: string;
}) {
  const note = input.note.trim();
  if (!note) throw new Error('Scrie o notă pentru Executor.');
  const { data, error } = await supabase.rpc('return_task_to_progress', {
    p_task_id: input.taskId,
    p_note: note,
  });
  if (error) throw reviewError(error.code);
  return data;
}
export function useReturnTaskToProgress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: returnTaskToProgress,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
