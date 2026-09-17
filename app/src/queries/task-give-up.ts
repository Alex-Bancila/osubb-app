import { useMutation, useQueryClient } from '@tanstack/react-query';
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

export class TaskGiveUpError extends Error {
  readonly kind: TaskGiveUpErrorKind;

  constructor(kind: TaskGiveUpErrorKind) {
    super(messages[kind]);
    this.kind = kind;
  }
}

export function taskGiveUpError(code?: string): TaskGiveUpError {
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
  );
}

export async function giveUpTask(taskId: number, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new TaskGiveUpError('reason_required');

  const { data, error } = await supabase.rpc('give_up_task', {
    p_task_id: taskId,
    p_reason: normalizedReason,
  });
  if (error) throw taskGiveUpError(error.code);
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
