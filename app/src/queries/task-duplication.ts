import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export function taskDuplicationErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  if (code === 'PT400') return 'Alege un termen-limită valid.';
  if (code === 'PT404') return 'Taskul sursă nu mai este disponibil.';
  if (code === 'PT409')
    return 'Acest task nu poate fi duplicat. Reîncarcă detaliile.';
  if (code === '42501') return 'Nu ai permisiunea să duplici acest task.';
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

export function useDuplicateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: duplicateTask,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
