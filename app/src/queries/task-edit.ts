import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';
import { taskDraftErrorMessage } from '../screens/tracker/task-draft-validation';
export type TaskContentInput = {
  taskId: number;
  title: string;
  description: string | null;
  deadline: string | null;
  campaignId: number | null;
};
export class TaskEditError extends Error {}
export async function updateTaskContent(input: TaskContentInput) {
  const args = {
    p_task_id: input.taskId,
    p_title: input.title.trim(),
    p_description: input.description?.trim() || null,
    p_deadline: input.deadline,
    p_campaign_id: input.campaignId,
  };
  // SQL takes full replacement values and NULL clears a field. Generated RPC
  // argument types omit PostgreSQL parameter nullability; keep this boundary local.
  const { data, error } = await supabase.rpc(
    'update_task_content',
    args as unknown as Database['public']['Functions']['update_task_content']['Args'],
  );
  if (error)
    throw new TaskEditError(
      error.code === '42501'
        ? 'Nu mai ai permisiunea de a edita acest task.'
        : error.code === 'PT409'
          ? error.message === 'nothing_to_update'
            ? 'Nu există modificări de salvat.'
            : 'Taskul s-a schimbat sau a fost finalizat. Verifică starea actuală.'
          : error.code === 'PT404'
            ? 'Taskul nu mai este disponibil.'
            : error.code === 'PT400'
              ? taskDraftErrorMessage(error)
              : 'Nu am putut salva modificările. Reîncearcă.',
    );
  return data;
}
export function useTaskEdit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateTaskContent,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
