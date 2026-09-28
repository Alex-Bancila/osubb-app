import type { TaskPresentation } from './task-presentation';

export type TaskStage = Pick<
  TaskPresentation,
  | 'status'
  | 'executor'
  | 'candidature'
  | 'overdue'
  | 'feedbackPending'
  | 'completedLate'
  | 'kind'
  | 'subtaskProgress'
>;

/**
 * The stage sentence under a Task's badges: only what the badges do not
 * already say (relevance B9). The status badge names De făcut, În lucru, În
 * verificare, Finalizat, Nerealizat and Anulat; the side badges name Termen
 * depășit, Modificări cerute and Finalizat cu întârziere. What is left is the
 * viewer's place in the Candidate Queue, an Umbrella's progress and an
 * assigned Task still waiting to start. `null` means "say nothing".
 *
 * Current-state copy only; Task Activity remains the immutable history.
 */
export function summarizeTaskStage(task: TaskStage): string | null {
  // A finished Task has no stage left to explain, whatever queue row remains.
  if (['completed', 'unfulfilled', 'cancelled'].includes(task.status))
    return null;
  if (task.candidature?.status === 'pending') {
    return task.candidature.position === null
      ? 'Ești pe lista de așteptare.'
      : `Ești pe locul ${task.candidature.position} în lista de așteptare.`;
  }
  if (task.kind === 'umbrella') {
    return task.subtaskProgress
      ? `${task.subtaskProgress.terminal} din ${task.subtaskProgress.total} subtaskuri sunt încheiate.`
      : 'Taskul grupează subtaskuri.';
  }
  // "De făcut" alone reads as unassigned; this says it has an Executor.
  if (task.status === 'todo' && task.executor)
    return 'Taskul este atribuit și așteaptă să fie început.';
  return null;
}
