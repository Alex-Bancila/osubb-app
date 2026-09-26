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
