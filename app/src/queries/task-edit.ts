import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { keys } from './keys';
export type TaskContentInput = {
  taskId: number;
  title: string;
  description: string | null;
  deadline: string | null;
  campaignId: number | null;
};
const commandErrors = new Map<string, string>([
  ['title_required', 'Scrie titlul taskului.'],
  ['deadline_required', 'Alege termenul taskului.'],
  ['umbrella_has_no_campaign', 'Taskul-umbrelă nu poate avea o campanie.'],
  ['task_terminal', 'Taskul a fost finalizat. Verifică starea actuală.'],
  ['nothing_to_update', 'Nu există modificări de salvat.'],
  ['invalid_campaign', 'Campania nu mai este disponibilă pentru grupul ales.'],
  ['task_not_found', 'Taskul nu mai este disponibil.'],
  ['task_command_forbidden', 'Nu mai ai permisiunea de a edita acest task.'],
  ['task_manage_forbidden', 'Nu mai ai permisiunea de a edita acest task.'],
]);
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
      commandErrors.get(error.message) ??
        'Nu am putut salva modificările. Reîncearcă.',
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
