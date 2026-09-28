import type { TaskPresentation } from './task-presentation';
import { TaskStageSummary } from './TaskStageSummary';
import { Button } from '../../components/ui/button';
import { useTaskQueue, type OwnTaskQueue } from '../../queries/task-queue';
import { queueText } from './queue-text';

export function QueuePosition({
  queue,
  stageShown = false,
}: {
  queue: OwnTaskQueue;
  /** The stage sentence is on screen and already names a pending place. */
  stageShown?: boolean;
}) {
  const text = queueText(queue, { stageShown });
  if (text === null) return null;
  return (
    <p role="status" className="text-sm">
      {text}
    </p>
  );
}
export function TaskQueueStatus({
  taskId,
  task,
}: {
  taskId: number;
  task?: TaskPresentation;
}) {
  const query = useTaskQueue(taskId);
  if (query.isPending)
    return (
      <p role="status" className="text-sm">
        Se încarcă înscrierea…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert">
        <p>Nu am putut încărca înscrierea.</p>
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => query.refetch()}
        >
          Reîncarcă înscrierea
        </Button>
      </div>
    );
  return (
    <>
      {task && (
        <TaskStageSummary
          task={{
            ...task,
            candidature: query.data.status
              ? { status: query.data.status, position: query.data.position }
              : null,
          }}
        />
      )}
      <QueuePosition queue={query.data} stageShown={task !== undefined} />
    </>
  );
}
