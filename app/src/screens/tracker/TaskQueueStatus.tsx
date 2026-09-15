import { Button } from '../../components/ui/button';
import { useTaskQueue, type OwnTaskQueue } from '../../queries/task-queue';

export function QueuePosition({ queue }: { queue: OwnTaskQueue }) {
  const text =
    queue.status === 'pending'
      ? queue.position === null
        ? 'Înscris în lista de așteptare. Poziția se actualizează.'
        : `Locul ${queue.position} în lista de așteptare`
      : queue.status === 'selected'
        ? 'Ai fost selectat pentru acest task.'
        : queue.status === 'withdrawn'
          ? 'Te-ai retras din lista de așteptare.'
          : queue.status === 'closed'
            ? 'Înscriere închisă.'
            : 'Nu ești înscris în lista de așteptare.';
  return (
    <p role="status" className="text-sm">
      {text}
    </p>
  );
}
export function TaskQueueStatus({ taskId }: { taskId: number }) {
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
  return <QueuePosition queue={query.data} />;
}
