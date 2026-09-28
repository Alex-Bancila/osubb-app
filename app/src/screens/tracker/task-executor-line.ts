import { isTerminalTask, type TaskPresentation } from './task-presentation';

/**
 * Whether a Task card (and so the details sheet, which shows the card) has an
 * "Executor:" line. The one place this is decided; the line says a fact only
 * when it is true and concerns the reader:
 *
 * - never on an Umbrella, which has no Executor of its own;
 * - never on the viewer's own Task (relevance B2): Începe / Trimite already
 *   say it is theirs;
 * - on a finished Task only when it names who finished it (B13, Audit D-1):
 *   `visible_task_executors` returns the Executor of a completed or
 *   unfulfilled Task (#861), so the manager who evaluated it still sees who
 *   did the work; a cancelled Task names nobody, and "Neatribuit" is never
 *   said of a finished Task;
 * - on a public Task (an Opportunity) only once someone holds it (B12): the
 *   join button already says it is open.
 */
export function showsExecutorLine(
  task: Pick<
    TaskPresentation,
    'kind' | 'status' | 'executor' | 'assignmentMode'
  >,
  memberId: string | undefined,
): boolean {
  if (task.kind !== 'task') return false;
  if (memberId !== undefined && task.executor?.memberId === memberId)
    return false;
  if (isTerminalTask(task.status)) return task.executor !== null;
  if (task.assignmentMode === 'public' && task.executor === null) return false;
  return true;
}
