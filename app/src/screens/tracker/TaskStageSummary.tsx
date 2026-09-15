import { summarizeTaskStage, type TaskStage } from './task-stage';

export function TaskStageSummary({ task }: { task: TaskStage }) {
  return (
    <p className="text-sm text-muted-foreground">{summarizeTaskStage(task)}</p>
  );
}
