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
 * An Opportunity as Disponibile shows it (ruling R26):
 * - `relevant` — the Task's Group is one of the Member's own. The Organization
 *   Group is an Automatic Membership of every Member, so its Opportunities are
 *   always relevant.
 * - `joinable` — the Task Audience admits the Member: their own Group's Task,
 *   or an org-Audience Task of any Group. The server's
 *   `task_audience_forbidden` remains the rule; this only decides the button.
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

/** The Member's own Candidatures, by Task id. */
export type OpportunityCandidatures = {
  /** Tasks the Member is a pending Candidate on. */
  pending?: ReadonlySet<number>;
  /** Tasks the Member has any Candidature on, whatever its status. */
  participated?: ReadonlySet<number>;
};

/**
 * Disponibile is one band (ruling R26): what the Member can join, plus what
 * they have taken part in, in deadline order. The server returns the Member's
 * own Groups' Opportunities and every Group's org-Audience ones (#794); a row
 * that leadership can read but not join (R1/R3) belongs to the management
 * tabs, so it is dropped here unless the Member holds a Candidature on it.
 */
export function orderOpportunities(
  rows: TaskPresentationRow[],
  memberships: TaskMemberships,
  {
    pending = new Set(),
    participated = new Set(),
  }: OpportunityCandidatures = {},
): Opportunity[] {
  return rows
    .map((task) => {
      const relevant = hasOwnOrigin(task, memberships);
      return {
        ...task,
        relevant,
        // A pending Candidate keeps their controls after leaving the Group:
        // `withdraw_task_interest` checks no Audience, so they can still leave.
        joinable: relevant || task.audience === 'org' || pending.has(task.id),
      };
    })
    .filter((task) => task.joinable || participated.has(task.id))
    .sort(compareByDeadline);
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
    orderOpportunities([...tasks.values()], scopes, {
      pending: pendingTaskIds,
      participated: participatedTaskIds,
    }),
  );
}

export function useTaskOpportunities() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.available(memberId),
    queryFn: memberId ? () => fetchTaskOpportunities(memberId) : skipToken,
  });
}
