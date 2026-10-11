import { useTaskEvaluationCapability } from '../../queries/task-review';
import type { TaskStatus } from './task-presentation';

/**
 * The rules for the actions the details sheet lists in its "⋯" menu, shared
 * by the menu (which item to show) and by the control that owns the action
 * (whether it may run), so the two never disagree.
 */

/** Anulează taskul: for a manager, before the Task ends. */
export function canCancelTask(status: TaskStatus, canManage: boolean) {
  return (
    canManage && !['completed', 'unfulfilled', 'cancelled'].includes(status)
  );
}

export type UnfulfilledInput = {
  status: TaskStatus;
  kind: string;
  overdue: boolean;
  /** mark_task_unfulfilled refuses a Task nobody is working on. */
  hasExecutor: boolean;
};

/** Marchează nerealizat, by the Task alone: overdue, held, not finished. */
export function unfulfilledAllowed({
  status,
  kind,
  overdue,
  hasExecutor,
}: UnfulfilledInput) {
  return (
    kind === 'task' &&
    overdue &&
    hasExecutor &&
    ['todo', 'in_progress', 'in_review'].includes(status)
  );
}

/** Marchează nerealizat is offered: such a Task, to who may evaluate it. */
export function useCanMarkUnfulfilled(
  input: UnfulfilledInput & { taskId: number },
) {
  const capability = useTaskEvaluationCapability(input.taskId);
  return capability.data === true && unfulfilledAllowed(input);
}
