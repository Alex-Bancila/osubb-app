import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export async function setTaskQueue({
  taskId,
  open,
}: {
  taskId: number;
  open: boolean;
}) {
  const { error } = await supabase.rpc('set_task_queue', {
    p_task_id: taskId,
    p_open: open,
  });
  if (!error) return;
  throw new Error(
    error.code === '42501'
      ? 'Nu ai permisiunea să modifici coada acestui task.'
      : error.code === 'PT409' || error.code === 'PT404'
        ? 'Coada s-a schimbat. Datele au fost actualizate.'
        : 'Nu am putut modifica coada. Încearcă din nou.',
  );
}
export function taskQueueControlOptions(client: QueryClient) {
  return {
    mutationFn: setTaskQueue,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useSetTaskQueue() {
  return useMutation(taskQueueControlOptions(useQueryClient()));
}
