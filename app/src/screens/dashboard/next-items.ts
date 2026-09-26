import type { EventPresentation } from '../../queries/events';
import { eventRelevance } from '../calendar/calendar-presentation';
import {
  isTerminalTask,
  type TaskPresentationRow,
} from '../tracker/task-presentation';

/**
 * **Următorul task** (ruling R4): the Task with the soonest deadline that is
 * still in work and whose current Executor is this Member. Overdue is simply
 * the soonest. `useMyTasks()` keeps every Assignment the Member ever held, so
 * "current Executor" is read from the Assignment rows: one of theirs that has
 * not ended. A Task they gave up (or were replaced on) is skipped, and so is a
 * Task with no deadline — there is nothing to be next by.
 */
export function nextOwnTask<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  memberId: string,
): Row | null {
  let next: Row | null = null;
  let nextAt = Infinity;
  for (const row of rows) {
    if (isTerminalTask(row.status) || row.deadline === null) continue;
    const at = Date.parse(row.deadline);
    if (!Number.isFinite(at) || at >= nextAt) continue;
    const executor = row.assignments?.some(
      (assignment) =>
        assignment.member_id === memberId && assignment.ended_at === null,
    );
    if (!executor) continue;
    next = row;
    nextAt = at;
  }
  return next;
}

/**
 * **Următorul eveniment** (ruling R4): the soonest Relevant Event that has not
 * started — one of the Organization Group, or of a Group whose Group Audience
 * holds the Member (`relevantGroupIds`). An Other OSUBB Event the Member said
 * "Vin" to is not promoted here: the glossary's relevance is the Audience.
 */
export function nextRelevantEvent(
  events: readonly EventPresentation[],
  relevant: ReadonlySet<number>,
  now: number,
): EventPresentation | null {
  let next: EventPresentation | null = null;
  let nextAt = Infinity;
  const none = new Set<number>();
  for (const event of events) {
    const at = Date.parse(event.startsAt);
    if (!Number.isFinite(at) || at < now || at >= nextAt) continue;
    if (eventRelevance(event, relevant, none) === 'other') continue;
    next = event;
    nextAt = at;
  }
  return next;
}
