import type { EventPresentation } from '../../queries/events';
import { eventRelevance } from '../calendar/calendar-presentation';
import type {
  TaskPresentationRow,
  TaskStatus,
} from '../tracker/task-presentation';

/** De făcut or În lucru: the statuses in which the Executor has work to do. */
function inWork(status: TaskStatus): boolean {
  return status === 'todo' || status === 'in_progress';
}

/**
 * The Tasks the Member still has to work on (ruling R4, #859 B1): De făcut or
 * În lucru — which includes a Task returned for changes — whose current
 * Executor is this Member. A Task În verificare waits on its reviewer, not on
 * them, so it is not counted. `useMyTasks()` holds Taskurile mele's open
 * Tasks (ruling R55), which is all this needs; "current Executor" is read
 * from their Assignment rows: one of theirs that has not ended. A Task they
 * gave up (or were replaced on) is skipped.
 */
export function ownTasksInWork<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  memberId: string,
): Row[] {
  return rows.filter(
    (row) =>
      inWork(row.status) &&
      row.assignments?.some(
        (assignment) =>
          assignment.member_id === memberId && assignment.ended_at === null,
      ),
  );
}

/**
 * The Member's Tasks in work that have a deadline, soonest first — an overdue
 * one is simply the soonest. A Task with no deadline has nothing to be next
 * by, so it is left to the count.
 */
export function ownTasksByDeadline<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  memberId: string,
): Row[] {
  return ownTasksInWork(rows, memberId)
    .flatMap((row) => {
      const at = row.deadline === null ? NaN : Date.parse(row.deadline);
      return Number.isFinite(at) ? [{ row, at }] : [];
    })
    .sort((a, b) => a.at - b.at || a.row.id - b.row.id)
    .map(({ row }) => row);
}

/**
 * The Relevant Events that have not started, soonest first (ruling R4): those
 * of the Organization Group, or of a Group whose Group Audience holds the
 * Member (`relevantGroupIds`). An Other OSUBB Event the Member said "Vin" to
 * is not promoted here: the glossary's relevance is the Audience. A cancelled
 * Event is not something to go to (#849), nor one BC has not published yet
 * (spec 2026-10-11).
 */
export function upcomingRelevantEvents(
  events: readonly EventPresentation[],
  relevant: ReadonlySet<number>,
  now: number,
): EventPresentation[] {
  const none = new Set<number>();
  return events
    .flatMap((event) => {
      const at = Date.parse(event.startsAt);
      if (!Number.isFinite(at) || at < now) return [];
      if (event.cancelledAt !== null) return [];
      if (event.approvalStatus !== 'approved') return [];
      if (eventRelevance(event, relevant, none) === 'other') return [];
      return [{ event, at }];
    })
    .sort((a, b) => a.at - b.at || a.event.id - b.event.id)
    .map(({ event }) => event);
}
