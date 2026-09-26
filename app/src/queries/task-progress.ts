import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskProgressAction = 'start' | 'submit';

/** The Submission Note and its Attached Link (#684), already trimmed. */
export type TaskSubmission = {
  note: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
};

export type TaskProgressInput =
  | { taskId: number; action: 'start' }
  | ({ taskId: number; action: 'submit' } & Partial<TaskSubmission>);

const CHANGED =
  'Taskul s-a schimbat sau nu mai poți face această acțiune. Lista a fost actualizată.';
const RETRY = 'Nu am putut salva schimbarea. Încearcă din nou.';

type SubmitArgs =
  Database['public']['Functions']['submit_task_for_review']['Args'];

function submitArgs(
  input: Extract<TaskProgressInput, { action: 'submit' }>,
): SubmitArgs {
  // Null means "no note" / "no link" to the command. Generated RPC argument
  // types omit PostgreSQL parameter nullability; keep that boundary here.
  return {
    p_task_id: input.taskId,
    p_note: input.note ?? null,
    p_link_label: input.linkLabel ?? null,
    p_link_url: input.linkUrl ?? null,
  } as unknown as SubmitArgs;
}

/** Only server commands change lifecycle state; the server derives the actor. */
export async function progressTask(input: TaskProgressInput): Promise<void> {
  const { error } =
    input.action === 'start'
      ? await supabase.rpc('start_task', { p_task_id: input.taskId })
      : await supabase.rpc('submit_task_for_review', submitArgs(input));
  if (!error) return;
  // A malformed note or link is the member's to fix: keep its reason so the
  // Submission Note dialog shows it under the field it belongs to.
  if (error.code === 'PT400') throw new CommandError(error, RETRY);
  if (['PT409', 'PT404', '42501'].includes(error.code))
    throw new CommandError(null, CHANGED);
  throw new CommandError(null, RETRY);
}

export function taskProgressMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: progressTask,
    // A conflict also requires a refresh. Never optimistically change Task state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}

export function useTaskProgress() {
  return useMutation(taskProgressMutationOptions(useQueryClient()));
}
