import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type PendingTaskCandidate = {
  id: number;
  memberId: string;
  memberName: string;
  joinedAt: string;
};

export type TaskCandidateSelectionErrorKind =
  'invalid' | 'missing' | 'conflict' | 'forbidden' | 'unknown';

const messages: Record<TaskCandidateSelectionErrorKind, string> = {
  invalid: 'Alege un candidat valid din coadă.',
  missing: 'Candidatura sau taskul nu mai este disponibil.',
  conflict: 'Coada s-a schimbat. Lista a fost actualizată.',
  forbidden: 'Nu ai permisiunea să alegi executorul acestui task.',
  unknown: 'Nu am putut schimba executorul. Încearcă din nou.',
};

export class TaskCandidateSelectionError extends Error {
  readonly kind: TaskCandidateSelectionErrorKind;

  constructor(kind: TaskCandidateSelectionErrorKind) {
    super(messages[kind]);
    this.kind = kind;
  }
}

export function taskCandidateSelectionError(
  code?: string,
): TaskCandidateSelectionError {
  return new TaskCandidateSelectionError(
    code === 'PT400'
      ? 'invalid'
      : code === 'PT404'
        ? 'missing'
        : code === 'PT409'
          ? 'conflict'
          : code === '42501'
            ? 'forbidden'
            : 'unknown',
  );
}

export async function fetchPendingTaskCandidates(
  taskId: number,
): Promise<PendingTaskCandidate[]> {
  const { data, error } = await supabase
    .from('task_candidates')
    .select(
      'id, member_id, joined_at, member:profiles_directory!task_candidates_member_id_fkey(full_name)',
    )
    .eq('task_id', taskId)
    .eq('status', 'pending')
    .order('joined_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw taskCandidateSelectionError(error.code);

  return data.map((candidate) => ({
    id: candidate.id,
    memberId: candidate.member_id,
    memberName: candidate.member?.full_name ?? 'Membru OSUBB',
    joinedAt: candidate.joined_at,
  }));
}

export async function selectTaskCandidate(
  taskId: number,
  candidateId: number,
  closeRemaining = false,
) {
  const { data, error } = await supabase.rpc('select_task_candidate', {
    p_task_id: taskId,
    p_candidate_id: candidateId,
    p_close_remaining: closeRemaining,
  });
  if (error) throw taskCandidateSelectionError(error.code);
  return data;
}

export function usePendingTaskCandidates(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.candidates(taskId, memberId),
    queryFn: memberId ? () => fetchPendingTaskCandidates(taskId) : skipToken,
  });
}

export function useSelectTaskCandidate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      candidateId,
      closeRemaining,
    }: {
      taskId: number;
      candidateId: number;
      closeRemaining?: boolean;
    }) => selectTaskCandidate(taskId, candidateId, closeRemaining),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
