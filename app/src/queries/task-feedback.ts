import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseOrRefuse } from '../lib/form-errors';
import { noteSchema } from '../lib/schemas/note';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { reviewError } from './task-review';

export async function returnTaskToProgress(input: {
  taskId: number;
  note: string;
}) {
  const { note } = parseOrRefuse(
    noteSchema,
    input,
    'Nu am putut trimite feedbackul. Încearcă din nou.',
  );
  const { data, error } = await supabase.rpc('return_task_to_progress', {
    p_task_id: input.taskId,
    p_note: note,
  });
  if (error)
    throw reviewError(error, {
      forbidden:
        'Nu mai ai permisiunea de a trimite acest task înapoi în lucru.',
      failed: 'Nu am putut trimite feedbackul. Încearcă din nou.',
    });
  return data;
}
export function useReturnTaskToProgress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: returnTaskToProgress,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
