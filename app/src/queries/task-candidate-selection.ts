import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { commandReason, reasonCopy } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type PendingTaskCandidate = {
  id: number;
  memberId: string;
  memberName: string;
  memberNickname?: string | null;
  avatarColor: string | null;
  joinedAt: string;
};

export type TaskCandidateSelectionErrorKind =
  | 'invalid'
  | 'missing'
  | 'conflict'
  | 'audience'
  | 'level'
  | 'forbidden'
  | 'unknown';

const messages: Record<TaskCandidateSelectionErrorKind, string> = {
  invalid: 'Alege un candidat valid din coadă.',
  missing: 'Candidatura sau taskul nu mai este disponibil.',
  conflict: 'Coada s-a schimbat. Lista a fost actualizată.',
  // #1125 (audit M1): the selection re-judges the Candidate against the
  // Task's join rule. The Candidature stays in the queue; only this pick is
  // refused, so the Manager reads why rather than "no permission".
  audience: 'Candidatul nu mai face parte din grup.',
  level: 'Candidatul e sub nivelul minim al taskului.',
  forbidden: 'Nu ai permisiunea să alegi executorul acestui task.',
  unknown: 'Nu am putut schimba executorul. Încearcă din nou.',
};

export class TaskCandidateSelectionError extends Error {
  readonly kind: TaskCandidateSelectionErrorKind;

  constructor(kind: TaskCandidateSelectionErrorKind, message?: string) {
    super(message ?? messages[kind]);
    this.kind = kind;
  }
}

/**
 * The kind follows the code class (the sheet refetches on a conflict); the
 * words are the reason's own copy (#1143), the class's only as the fallback.
 * The two Candidate-eligibility reasons keep the sheet's words: the table's
 * copy for them speaks to the Member joining, and here they are about the
 * Candidate (#1125).
 */
export function taskCandidateSelectionError(
  code?: string,
  message?: string,
): TaskCandidateSelectionError {
  const kind: TaskCandidateSelectionErrorKind =
    message === 'task_audience_forbidden'
      ? 'audience'
      : message === 'task_level_forbidden'
        ? 'level'
        : code === 'PT400'
          ? 'invalid'
          : code === 'PT404'
            ? 'missing'
            : code === 'PT409'
              ? 'conflict'
              : code === '42501'
                ? 'forbidden'
                : 'unknown';
  return new TaskCandidateSelectionError(
    kind,
    kind === 'audience' || kind === 'level'
      ? undefined
      : reasonCopy(commandReason({ message })),
  );
}

export async function fetchPendingTaskCandidates(
  taskId: number,
): Promise<PendingTaskCandidate[]> {
  const { data, error } = await supabase
    .from('task_candidates')
    .select(
      'id, member_id, joined_at, member:profiles_directory!task_candidates_member_id_fkey(full_name, nickname, avatar_color)',
    )
    .eq('task_id', taskId)
    .eq('status', 'pending')
    .order('joined_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw taskCandidateSelectionError(error.code, error.message);

  return data.map((candidate) => ({
    id: candidate.id,
    memberId: candidate.member_id,
    memberName: candidate.member?.full_name ?? 'Membru OSUBB',
    memberNickname: candidate.member?.nickname?.trim() || null,
    avatarColor: candidate.member?.avatar_color ?? null,
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
  if (error) throw taskCandidateSelectionError(error.code, error.message);
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
