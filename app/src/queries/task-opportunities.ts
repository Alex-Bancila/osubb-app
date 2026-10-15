import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import { fetchMyGroups, memberGroupIds } from './my-groups';
import {
  readWholeTaskRows,
  taskListRow,
  useLabelledRead,
  type ListRead,
} from './task-lists';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/**
 * The ids of the Groups this Member is a member of, from `my_groups()`. Read
 * live on every read of Disponibile, so an Appointment into a Group makes
 * its local Opportunities "own" on the next read, with no re-login.
 */
export type TaskMemberships = ReadonlySet<number>;

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

/**
 * Disponibile in two requests side by side (spec 2026-10-14, part 3): the
 * Member's Groups, and `task_list('available')` — the open public
 * Opportunities they read with a queue still open, and every Task they are a
 * pending Candidate on, whatever its queue, so they can withdraw. Each row
 * carries the Member's Candidature and the Task's Executor, so nothing more
 * is asked. Which of them the Member can join is decided here
 * (`orderOpportunities`); Grupuri preferate narrows them on the page (R43).
 */
export async function fetchTaskOpportunities(
  memberId: string,
): Promise<Opportunity[]> {
  const [groups, rows] = await Promise.all([
    fetchMyGroups(),
    readWholeTaskRows({ p_list: 'available', p_finished: false }),
  ]);
  const pending = new Set(
    rows.filter((row) => row.my_candidature === 'pending').map((row) => row.id),
  );
  return orderOpportunities(rows.map(taskListRow), memberGroupIds(groups), {
    pending,
    memberId,
  });
}

/** Disponibile, labelled like every other list. */
export function useTaskOpportunities(): ListRead<Opportunity> {
  const memberId = useAuth().session?.user.id;
  const query = useQuery({
    queryKey: keys.tasks.available(memberId),
    queryFn: memberId ? () => fetchTaskOpportunities(memberId) : skipToken,
  });
  return useLabelledRead(query);
}
