import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
const commandErrors = new Map<string, string>([
  [
    'invalid_executor',
    'Membrul nu mai este eligibil. Alege un membru activ care îndeplinește nivelul minim.',
  ],
  ['task_command_forbidden', 'Nu mai ai permisiunea de a atribui acest task.'],
  ['task_manage_forbidden', 'Nu mai ai permisiunea de a atribui acest task.'],
  ['task_not_found', 'Taskul nu mai este disponibil.'],
  ['task_is_umbrella', 'Un task-umbrelă nu primește Executor.'],
  ['task_not_direct', 'Taskul nu mai folosește atribuirea directă.'],
  ['task_terminal', 'Taskul a fost finalizat. Verifică starea actuală.'],
  [
    'task_already_assigned',
    'Taskul are deja un Executor. Verifică starea actuală.',
  ],
]);
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
      commandErrors.get(error.message) ??
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
