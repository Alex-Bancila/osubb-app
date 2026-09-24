import { skipToken, useQuery } from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';
import { keys } from './keys';

/** The part of a Task a Calendar chip and day row read. */
export type CalendarTaskRow = Pick<
  TaskPresentationRow,
  'id' | 'title' | 'status' | 'deadline' | 'group_id' | 'campaign_id' | 'group'
>;

/**
 * The Tasks on which this member holds a **pending** candidature — the second
 * half of "my own Task deadlines" (ADR-0008 amended 2026-09-23): a Candidate
 * waiting in the queue has a deadline to plan around too. Asked from
 * `task_candidates` inwards and self-filtered, because a manager may read other
 * members' candidatures through RLS; the Task arrives through its own RLS.
 */
export async function fetchPendingCandidatureTasks(
  memberId: string,
): Promise<CalendarTaskRow[]> {
  const { data, error } = await supabase
    .from('task_candidates')
    .select(
      'task:tasks!task_candidates_task_id_fkey(id, title, status, deadline, group_id, campaign_id, group:groups!tasks_group_id_fkey(name, short, color, category, path, is_organization))',
    )
    .eq('member_id', memberId)
    .eq('status', 'pending');
  if (error) throw error;
  const tasks = new Map<number, CalendarTaskRow>();
  for (const row of (data ?? []) as { task: CalendarTaskRow | null }[])
    if (row.task && !tasks.has(row.task.id)) tasks.set(row.task.id, row.task);
  return [...tasks.values()];
}

export function usePendingCandidatureTasks() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.candidatures(memberId),
    queryFn: memberId
      ? () => fetchPendingCandidatureTasks(memberId)
      : skipToken,
  });
}
