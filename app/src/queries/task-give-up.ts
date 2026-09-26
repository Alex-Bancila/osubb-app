import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CommandError } from '../lib/command-reasons';
import { reasonSchema } from '../lib/schemas/reason';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskGiveUpErrorKind =
  'reason_required' | 'forbidden' | 'missing' | 'conflict' | 'unknown';

const messages: Record<TaskGiveUpErrorKind, string> = {
  reason_required: 'Scrie motivul pentru care renunți la task.',
  forbidden: 'Nu mai poți renunța la acest task.',
  missing: 'Taskul nu mai este disponibil.',
  conflict: 'Taskul s-a schimbat și nu mai permite renunțarea.',
  unknown: 'Nu am putut salva renunțarea. Încearcă din nou.',
};

/**
 * A refused give-up. A reason we know keeps its shared copy (so the form can
 * show it under the reason field); otherwise the code picks the copy.
 */
export class TaskGiveUpError extends CommandError {
  readonly kind: TaskGiveUpErrorKind;

  constructor(kind: TaskGiveUpErrorKind, error?: unknown) {
    super(error, messages[kind]);
    this.kind = kind;
  }
}

export function taskGiveUpError(code?: string, error?: unknown) {
  return new TaskGiveUpError(
    code === 'PT400'
      ? 'reason_required'
      : code === '42501'
        ? 'forbidden'
        : code === 'PT404'
          ? 'missing'
          : code === 'PT409'
            ? 'conflict'
            : 'unknown',
    error,
  );
}

export async function giveUpTask(taskId: number, reason: string) {
  const parsed = reasonSchema.safeParse({ reason });
  if (!parsed.success)
    throw new TaskGiveUpError('reason_required', {
      message: parsed.error.issues[0]?.message,
    });

  const { data, error } = await supabase.rpc('give_up_task', {
    p_task_id: taskId,
    p_reason: parsed.data.reason,
  });
  if (error) throw taskGiveUpError(error.code, error);
  return data;
}

export function useGiveUpTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: number; reason: string }) =>
      giveUpTask(taskId, reason),
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
