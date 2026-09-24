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

/**
 * An Opportunity as Disponibile shows it (ruling R10):
 * - `relevant` — the Task's Group is one of the Member's own, so it belongs in
 *   the upper band. The Organization Group is an Automatic Membership of every
 *   Member, so its Opportunities are always relevant.
 * - `joinable` — the Task Audience admits the Member: their own Group's Task,
 *   or an org-Audience Task of any Group. A local-Audience Other OSUBB
 *   Opportunity is shown but cannot be joined; the server's
 *   `task_audience_forbidden` remains the rule, this only hides the button.
 */
export type Opportunity = TaskPresentationRow & {
  relevant: boolean;
  joinable: boolean;
};

function deadlineTime(task: TaskPresentationRow): number {
  const time = task.deadline ? Date.parse(task.deadline) : Number.NaN;
  return Number.isFinite(time) ? time : Infinity;
}

/** Deadline ascending, undated last, then title (Romanian), then id. */
export function compareByDeadline(
  a: TaskPresentationRow,
  b: TaskPresentationRow,
): number {
  const byDeadline = deadlineTime(a) - deadlineTime(b);
  return (
    (Number.isNaN(byDeadline) ? 0 : byDeadline) ||
    a.title.localeCompare(b.title, 'ro') ||
    a.id - b.id
  );
}

/**
 * Every row the server returned is an Opportunity (#683 decides visibility);
 * this only classifies them and orders the own band before the other band,
 * each in deadline order. A Candidature never moves a row between bands.
 */
export function orderOpportunities(
  rows: TaskPresentationRow[],
  memberships: TaskMemberships,
  pendingTaskIds: ReadonlySet<number> = new Set(),
): Opportunity[] {
  return rows
    .map((task) => {
      const relevant = hasOwnOrigin(task, memberships);
      return {
        ...task,
        relevant,
        // A pending Candidate keeps their controls after leaving the Group:
        // `withdraw_task_interest` checks no Audience, so they can still leave.
        joinable:
          relevant || task.audience === 'org' || pendingTaskIds.has(task.id),
      };
    })
    .sort(
      (a, b) =>
        Number(b.relevant) - Number(a.relevant) || compareByDeadline(a, b),
    );
}

export async function fetchTaskOpportunities(
  memberId: string,
): Promise<Opportunity[]> {
  const [scopes, candidatures] = await Promise.all([
    fetchTaskMemberships(),
    supabase
      .from('task_candidates')
      .select('task_id, status')
      .eq('member_id', memberId),
  ]);
  if (candidatures.error) throw candidatures.error;

  const participatedTaskIds = new Set(
    (candidatures.data ?? []).map((candidate) => candidate.task_id),
  );
  const pendingTaskIds = new Set(
    (candidatures.data ?? [])
      .filter((candidate) => candidate.status === 'pending')
      .map((candidate) => candidate.task_id),
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
    orderOpportunities([...tasks.values()], scopes, pendingTaskIds),
  );
}

export function useTaskOpportunities() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.available(memberId),
    queryFn: memberId ? () => fetchTaskOpportunities(memberId) : skipToken,
  });
}
