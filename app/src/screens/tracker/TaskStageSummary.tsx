import { summarizeTaskStage, type TaskStage } from './task-stage';

/** The stage sentence, or nothing when the badges already say it (B9). */
export function TaskStageSummary({ task }: { task: TaskStage }) {
  const summary = summarizeTaskStage(task);
  if (summary === null) return null;
  return <p className="text-sm text-muted-foreground">{summary}</p>;
}
