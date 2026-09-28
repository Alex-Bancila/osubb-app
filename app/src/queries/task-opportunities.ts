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

/** A Task still open to Candidates: neither finished, cancelled nor unfulfilled. */
export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'in_review'] as const;

function isOpen(task: TaskPresentationRow): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
}

/** The Member is this Task's current Executor (an assignment not yet ended). */
function executes(task: TaskPresentationRow, memberId: string): boolean {
  return (task.assignments ?? []).some(
    (assignment) =>
      assignment.member_id === memberId && assignment.ended_at === null,
  );
}

/** What Disponibile needs to know about the viewer beyond their Groups. */
export type OpportunityViewer = {
  /** Tasks the Member is a pending Candidate on. */
  pending?: ReadonlySet<number>;
  /** The viewer: a Task they execute is theirs, not an Opportunity. */
  memberId?: string;
};

/**
 * Disponibile is one band (ruling R26): what the Member can join or withdraw
 * from now, in deadline order (#846, B10/B11). The server returns the
 * Member's own Groups' Opportunities and every Group's org-Audience ones
 * (#794); a row that leadership can read but not join (R1/R3) belongs to the
 * management tabs, so it is dropped here unless the Member is a pending
 * Candidate on it. A finished, cancelled or unfulfilled Task, and a Task the
 * Member executes, live in Taskurile mele — never here.
 */
export function orderOpportunities(
  rows: TaskPresentationRow[],
  memberships: TaskMemberships,
  { pending = new Set(), memberId }: OpportunityViewer = {},
): Opportunity[] {
  return rows
    .filter(
      (task) =>
        isOpen(task) && (memberId === undefined || !executes(task, memberId)),
    )
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
    .filter((task) => task.joinable)
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
    .in('status', [...OPEN_TASK_STATUSES]);
  const openResult = await openTasks;
  if (openResult.error) throw openResult.error;
  const pendingIds = [...pendingTaskIds];
  const batches: number[][] = [];
  for (let offset = 0; offset < pendingIds.length; offset += 100)
    batches.push(pendingIds.slice(offset, offset + 100));
  const queuedResults = await Promise.all(
    batches.map((ids) =>
      latestSubmissionOnly(
        supabase.from('tasks').select(TASK_PRESENTATION_FIELDS),
      )
        .eq('kind', 'task')
        .eq('assignment_mode', 'public')
        .in('id', ids),
    ),
  );
  const queuedTasks: TaskPresentationRow[] = [];
  for (const result of queuedResults) {
    if (result.error) throw result.error;
    queuedTasks.push(...result.data);
  }

  // The server remains authoritative for both sets. The second query keeps a
  // pending Candidate's Task after its queue closes, so they can withdraw.
  const tasks = new Map<number, TaskPresentationRow>();
  for (const task of [...openResult.data, ...queuedTasks])
    tasks.set(task.id, task);
  return attachVisibleTaskExecutors(
    orderOpportunities([...tasks.values()], scopes, {
      pending: pendingTaskIds,
      memberId,
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
