import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import {
  fetchOwnCandidature,
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
  const candidate = await fetchOwnCandidature(taskId, memberId);
  if (!candidate) return { status: null, position: null };
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
export function useTaskQueue(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.queue(taskId, memberId),
    queryFn: memberId ? () => fetchTaskQueue(taskId, memberId) : skipToken,
    // Refetch also on focus; polling covers queue changes by another Member.
    refetchInterval: 15_000,
  });
}
