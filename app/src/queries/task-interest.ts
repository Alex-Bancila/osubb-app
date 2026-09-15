import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskInterestResult =
  { kind: 'assigned' } | { kind: 'queued'; position: number };
export type TaskInterestErrorKind =
  'forbidden' | 'conflict' | 'invalid' | 'unknown';
const messages: Record<TaskInterestErrorKind, string> = {
  forbidden: 'Nu mai poți participa la acest task.',
  conflict: 'Taskul s-a schimbat. Lista a fost actualizată.',
  invalid: 'Nu te poți înscrie la acest task în starea curentă.',
  unknown:
    'Nu am putut confirma starea înscrierii. Reîncarcă lista și încearcă din nou.',
};
export class TaskInterestError extends Error {
  readonly kind: TaskInterestErrorKind;
  constructor(kind: TaskInterestErrorKind) {
    super(messages[kind]);
    this.kind = kind;
  }
}
export function taskInterestError(code?: string): TaskInterestError {
  return new TaskInterestError(
    code === '42501'
      ? 'forbidden'
      : code === 'PT409' || code === 'PT404'
        ? 'conflict'
        : code === 'PT400'
          ? 'invalid'
          : 'unknown',
  );
}

/** Explicitly self-filtered even when a manager may read other Candidates. */
export async function fetchOwnCandidature(taskId: number, memberId: string) {
  const { data, error } = await supabase
    .from('task_candidates')
    .select('id, status, joined_at')
    .eq('task_id', taskId)
    .eq('member_id', memberId)
    .order('joined_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw taskInterestError(error.code);
  return data;
}

export async function fetchOwnQueuePosition(
  taskId: number,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('task_queue_summary')
    .select('my_position')
    .eq('task_id', taskId)
    .maybeSingle();
  if (error) throw taskInterestError(error.code);
  return data?.my_position ?? null;
}

export async function expressTaskInterest(
  taskId: number,
  memberId: string,
): Promise<TaskInterestResult> {
  const { error } = await supabase.rpc('express_task_interest', {
    p_task_id: taskId,
  });
  if (error) throw taskInterestError(error.code);
  const candidate = await fetchOwnCandidature(taskId, memberId);
  if (candidate?.status === 'selected') return { kind: 'assigned' };
  if (candidate?.status === 'pending') {
    const position = await fetchOwnQueuePosition(taskId);
    if (position !== null) return { kind: 'queued', position };
  }
  throw new TaskInterestError('conflict');
}

export function taskInterestMutationOptions(
  client: QueryClient,
  memberId: string | undefined,
) {
  return {
    mutationFn: (taskId: number) => {
      if (!memberId) throw new TaskInterestError('forbidden');
      return expressTaskInterest(taskId, memberId);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  };
}
export function useExpressTaskInterest() {
  const memberId = useAuth().session?.user.id;
  return useMutation(taskInterestMutationOptions(useQueryClient(), memberId));
}
