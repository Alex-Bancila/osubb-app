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
/**
 * What the queue says of the Member, from a queue state already known: the
 * stage sentence with their place, then the queue line. Disponibile's rows
 * hand it the row's own state (#1133); `TaskQueueStatus` reads one Task's.
 */
export function OwnQueueStatus({
  queue,
  task,
}: {
  queue: OwnTaskQueue;
  task?: TaskPresentation;
}) {
  return (
    <>
      {task && (
        <TaskStageSummary
          task={{
            ...task,
            candidature: queue.status
              ? { status: queue.status, position: queue.position }
              : null,
          }}
        />
      )}
      <QueuePosition queue={queue} stageShown={task !== undefined} />
    </>
  );
}

/** One Task's queue, read: the details sheet, and a row given no state. */
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
          // Above a row's stretched open button.
          className="relative z-10 min-h-11 min-w-11"
          onClick={() => query.refetch()}
        >
          Reîncarcă înscrierea
        </Button>
      </div>
    );
  return <OwnQueueStatus queue={query.data} task={task} />;
}
