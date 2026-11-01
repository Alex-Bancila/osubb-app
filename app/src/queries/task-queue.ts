import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import {
  fetchOwnCandidature,
  hasOwnActiveAssignment,
  fetchOwnQueuePosition,
  TaskInterestError,
} from './task-interest';

export type OwnTaskQueue = {
  status: 'pending' | 'selected' | 'withdrawn' | 'closed' | null;
  position: number | null;
};
export async function fetchTaskQueue(
  taskId: number,
  memberId: string,
): Promise<OwnTaskQueue> {
  if (await hasOwnActiveAssignment(taskId, memberId))
    return { status: 'selected', position: null };
  const candidate = await fetchOwnCandidature(taskId, memberId);
  // A `selected` Candidature without an open Assignment is history: the Member
  // gave the Task up or was replaced, so "Ai fost selectat" would be untrue
  // (Audit D-3). They may join the queue again.
  if (!candidate || candidate.status === 'selected')
    return { status: null, position: null };
  const status = candidate.status;
  if (
    status !== 'pending' &&
    status !== 'selected' &&
    status !== 'withdrawn' &&
    status !== 'closed'
  )
    throw new TaskInterestError('unknown');
  return {
    status,
    position: status === 'pending' ? await fetchOwnQueuePosition(taskId) : null,
  };
}
/**
 * One Task's queue, for where one Task is opened (the details sheet). Under
 * `['tasks']`, so every `task_candidates` change refreshes it (ADR-0011):
 * nothing polls (#1133).
 */
export function useTaskQueue(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.queue(taskId, memberId),
    queryFn: memberId ? () => fetchTaskQueue(taskId, memberId) : skipToken,
  });
}

const ID_CHUNK = 100;

/**
 * The Member's own place in each of these Tasks' queues, from
 * `task_queue_summary` (which never names another Candidate), in one request
 * for up to a hundred Tasks. A Task where they wait on no queue is absent.
 */
export async function fetchQueuePositions(
  taskIds: readonly number[],
): Promise<ReadonlyMap<number, number>> {
  const positions = new Map<number, number>();
  for (let offset = 0; offset < taskIds.length; offset += ID_CHUNK) {
    const { data, error } = await supabase
      .from('task_queue_summary')
      .select('task_id, my_position')
      .in('task_id', taskIds.slice(offset, offset + ID_CHUNK));
    if (error) throw error;
    for (const row of data ?? [])
      if (row.task_id !== null && row.my_position !== null)
        positions.set(row.task_id, row.my_position);
  }
  return positions;
}

/**
 * Disponibile's places in the queue (#1133): one read for every row the
 * Member waits on, instead of two or three reads a row. Under `['tasks']`,
 * so a join, a withdrawal or anyone's Candidature change re-reads it.
 */
export function useQueuePositions(taskIds: readonly number[]) {
  const memberId = useAuth().session?.user.id;
  const ids = [...new Set(taskIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: keys.tasks.queuePositions(memberId, ids),
    queryFn:
      memberId && ids.length ? () => fetchQueuePositions(ids) : skipToken,
  });
}
