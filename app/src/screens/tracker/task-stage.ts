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

/** Current-state copy only; Task Activity remains the immutable history. */
export function summarizeTaskStage(task: TaskStage): string {
  if (task.status === 'completed') {
    return task.completedLate
      ? 'Taskul a fost finalizat cu întârziere.'
      : 'Taskul a fost finalizat.';
  }
  if (task.status === 'unfulfilled')
    return 'Taskul a fost evaluat ca nerealizat.';
  if (task.status === 'cancelled') return 'Taskul a fost anulat.';

  let summary: string;
  if (task.candidature?.status === 'pending') {
    summary =
      task.candidature.position === null
        ? 'Ești pe lista de așteptare.'
        : `Ești pe locul ${task.candidature.position} în lista de așteptare.`;
  } else if (task.kind === 'umbrella') {
    summary = task.subtaskProgress
      ? `${task.subtaskProgress.terminal} din ${task.subtaskProgress.total} subtaskuri sunt încheiate.`
      : 'Taskul grupează subtaskuri.';
  } else if (task.status === 'in_review') {
    summary = 'Lucrarea a fost trimisă și așteaptă verificarea.';
  } else if (task.feedbackPending) {
    summary = 'Lucrarea a fost returnată pentru modificări.';
  } else if (task.status === 'in_progress') {
    summary = 'Lucrul la task a început.';
  } else if (task.executor) {
    summary = 'Taskul este atribuit și așteaptă să fie început.';
  } else {
    // An absent Assignment embed can be RLS, not an unassigned Task.
    summary = 'Taskul este de făcut.';
  }
  return task.overdue ? `${summary} Termenul a fost depășit.` : summary;
}
