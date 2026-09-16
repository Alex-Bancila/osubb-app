import type { TaskPresentation } from './task-presentation';
import { TaskStageSummary } from './TaskStageSummary';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useTaskQueue } from '../../queries/task-queue';
import {
  useExpressTaskInterest,
  TaskInterestError,
} from '../../queries/task-interest';
import { useWithdrawTaskInterest } from '../../queries/task-withdrawal';
import { QueuePosition } from './TaskQueueStatus';

export function TaskInterestControls({
  taskId,
  task,
}: {
  taskId: number;
  task?: TaskPresentation;
}) {
  const queue = useTaskQueue(taskId);
  const join = useExpressTaskInterest();
  const withdraw = useWithdrawTaskInterest();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act() {
    if (busy || join.isPending || withdraw.isPending || !queue.data) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (queue.data.status === 'pending') {
        await withdraw.mutateAsync(taskId);
        setMessage('Te-ai retras din lista de așteptare.');
      } else {
        const result = await join.mutateAsync(taskId);
        setMessage(
          result.kind === 'assigned'
            ? 'Ai fost selectat ca Executor.'
            : `Te-ai înscris pe locul ${result.position} în lista de așteptare.`,
        );
      }
    } catch (failure) {
      setError(
        failure instanceof TaskInterestError
          ? failure.message
          : 'Nu am putut confirma înscrierea. Reîncarcă lista.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (queue.isPending) return <p role="status">Se încarcă înscrierea…</p>;
  if (queue.isError)
    return (
      <div role="alert">
        <p>Nu am putut încărca înscrierea.</p>
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => queue.refetch()}
        >
          Reîncarcă înscrierea
        </Button>
      </div>
    );
  return (
    <div className="space-y-3">
      {task && (
        <TaskStageSummary
          task={{
            ...task,
            candidature: queue.data.status
              ? { status: queue.data.status, position: queue.data.position }
              : null,
          }}
        />
      )}
      <QueuePosition queue={queue.data} />
      {queue.data.status !== 'selected' && (
        <Button
          variant="outline"
          className="min-h-11 min-w-11 whitespace-normal"
          disabled={busy || join.isPending || withdraw.isPending}
          onClick={act}
        >
          {busy
            ? 'Se salvează…'
            : queue.data.status === 'pending'
              ? 'Retrage înscrierea'
              : queue.data.status
                ? 'Înscrie-te din nou'
                : 'Vreau să particip'}
        </Button>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
