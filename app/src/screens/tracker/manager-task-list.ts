import type { TaskPresentation } from './task-presentation';

/** Today's nine Stare options: six statuses and three derived states. */
export const MANAGER_TASK_STATES = [
  ['todo', 'De făcut'],
  ['in_progress', 'În lucru'],
  ['in_review', 'În verificare'],
  ['completed', 'Finalizat'],
  ['unfulfilled', 'Nerealizat'],
  ['cancelled', 'Anulat'],
  ['overdue', 'Termen depășit'],
  ['feedback', 'Modificări cerute'],
  ['late', 'Finalizat cu întârziere'],
] as const;

export type ManagerTaskSort = 'deadline' | 'title';

/** The states only a finished Task has: what the server filters by (#1053). */
export const FINISHED_STATES = [
  'completed',
  'unfulfilled',
  'cancelled',
  'late',
] as const;
export type FinishedState = (typeof FINISHED_STATES)[number];

export function isFinishedState(state: string): state is FinishedState {
  return (FINISHED_STATES as readonly string[]).includes(state);
}

/** A state only an open Task has: no finished Task can match it. */
export function isOpenState(state: string): boolean {
  return state !== '' && !isFinishedState(state);
}

/**
 * How many finished Tasks a list holds in each state, from its summary rows
 * (`task_list_summary`): `late` counts the completed ones that were late,
 * `total` every finished Task.
 */
export function finishedStateCounts(
  rows: readonly { status: string; late: boolean; tasks: number }[],
): Record<FinishedState, number> & { total: number } {
  const counts = {
    completed: 0,
    unfulfilled: 0,
    cancelled: 0,
    late: 0,
    total: 0,
  };
  for (const row of rows) {
    if (
      row.status !== 'completed' &&
      row.status !== 'unfulfilled' &&
      row.status !== 'cancelled'
    )
      continue;
    counts[row.status] += row.tasks;
    counts.total += row.tasks;
    if (row.late) counts.late += row.tasks;
  }
  return counts;
}

export function matchesTaskState(
  task: TaskPresentation,
  state: string,
): boolean {
  if (!state) return true;
  if (state === 'overdue') return task.overdue;
  if (state === 'feedback') return task.feedbackPending;
  if (state === 'late') return task.completedLate;
  return task.status === state;
}

/** Case- and diacritic-insensitive: "sedinta" finds "Ședință". */
export function searchableTitle(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro');
}

function deadlineTime(task: TaskPresentation): number {
  return task.deadline ? Date.parse(task.deadline) : Infinity;
}

/**
 * Overdue first (ruling R10), then the chosen order: deadline ascending with
 * undated last, then title — or title, then deadline. Ties end on the id.
 */
export function compareManagedTasks(sort: ManagerTaskSort) {
  return (a: TaskPresentation, b: TaskPresentation): number => {
    const byDeadline = deadlineTime(a) - deadlineTime(b);
    const deadline = Number.isNaN(byDeadline) ? 0 : byDeadline;
    const title = a.title.localeCompare(b.title, 'ro');
    return (
      Number(b.overdue) - Number(a.overdue) ||
      (sort === 'title' ? title || deadline : deadline || title) ||
      a.id - b.id
    );
  };
}
