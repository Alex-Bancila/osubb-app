import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { fetchMyGroups, memberGroupIds } from './my-groups';
import { latestSubmissionOnly, TASK_PRESENTATION_FIELDS } from './tasks';
import { attachVisibleTaskExecutors } from './task-executors';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/** The ids of the Groups this Member is a member of, from `my_groups()`. */
export type TaskMemberships = ReadonlySet<number>;

/**
 * Read live on every fetch of Available work, so an Appointment into a Group
 * makes its local Opportunities "own" on the next refetch, with no re-login.
 */
export async function fetchTaskMemberships(): Promise<TaskMemberships> {
  return memberGroupIds(await fetchMyGroups());
}

/**
 * Exact membership of the Task's own Group — never an ancestor or descendant
 * walk: a Department member is not a member of its Child Team.
 */
export function hasOwnOrigin(
  task: TaskPresentationRow,
  memberships: TaskMemberships,
): boolean {
  return memberships.has(task.group_id);
}

export function orderOpportunities(
  rows: TaskPresentationRow[],
  scopes: TaskMemberships,
  participatedTaskIds: ReadonlySet<number> = new Set(),
): TaskPresentationRow[] {
  // Managers may read local Tasks outside their memberships; those are not
  // Opportunities they can join. This narrows the already-authorized rows.
  return rows
    .filter(
      (task) =>
        participatedTaskIds.has(task.id) ||
        task.audience === 'org' ||
        hasOwnOrigin(task, scopes),
    )
    .sort(
      (a, b) =>
        Number(hasOwnOrigin(b, scopes)) - Number(hasOwnOrigin(a, scopes)) ||
        (a.deadline ? Date.parse(a.deadline) : Infinity) -
          (b.deadline ? Date.parse(b.deadline) : Infinity) ||
        a.title.localeCompare(b.title, 'ro') ||
        a.id - b.id,
    );
}

export async function fetchTaskOpportunities(
  memberId: string,
): Promise<TaskPresentationRow[]> {
  const [scopes, candidatures] = await Promise.all([
    fetchTaskMemberships(),
    supabase
      .from('task_candidates')
      .select('task_id')
      .eq('member_id', memberId),
  ]);
  if (candidatures.error) throw candidatures.error;

  const participatedTaskIds = new Set(
    (candidatures.data ?? []).map((candidate) => candidate.task_id),
  );
  const openTasks = latestSubmissionOnly(
    supabase.from('tasks').select(TASK_PRESENTATION_FIELDS),
  )
    .eq('kind', 'task')
    .eq('assignment_mode', 'public')
    .is('queue_closed_at', null)
    .in('status', ['todo', 'in_progress', 'in_review']);
  const openResult = await openTasks;
  if (openResult.error) throw openResult.error;
  const participatedTasks: TaskPresentationRow[] = [];
  const participatedIds = [...participatedTaskIds];
  for (let offset = 0; offset < participatedIds.length; offset += 100) {
    const result = await latestSubmissionOnly(
      supabase.from('tasks').select(TASK_PRESENTATION_FIELDS),
    )
      .eq('kind', 'task')
      .eq('assignment_mode', 'public')
      .in('id', participatedIds.slice(offset, offset + 100));
    if (result.error) throw result.error;
    participatedTasks.push(...result.data);
  }

  // The server remains authoritative for both sets. The second query retains
  // an existing participant's state after the queue or Task becomes terminal.
  const tasks = new Map<number, TaskPresentationRow>();
  for (const task of [...openResult.data, ...participatedTasks])
    tasks.set(task.id, task);
  return attachVisibleTaskExecutors(
    orderOpportunities([...tasks.values()], scopes, participatedTaskIds),
  );
}

export function useTaskOpportunities() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.available(memberId),
    queryFn: memberId ? () => fetchTaskOpportunities(memberId) : skipToken,
  });
}
