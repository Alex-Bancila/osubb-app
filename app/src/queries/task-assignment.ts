import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
export class TaskAssignmentError extends Error {}
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
      error.code === 'PT400'
        ? 'Membrul nu mai este eligibil. Alege un membru activ care îndeplinește nivelul minim.'
        : error.code === '42501'
          ? 'Nu mai ai permisiunea de a atribui acest task.'
          : ['PT409', 'PT404'].includes(error.code)
            ? 'Taskul s-a schimbat. Verifică executorul și încearcă din nou.'
            : 'Nu am putut atribui taskul. Încearcă din nou.',
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
