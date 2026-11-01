import type { TaskPresentation } from './task-presentation';
import { TaskStageSummary } from './TaskStageSummary';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import type { OwnTaskQueue } from '../../queries/task-queue';
import {
  useExpressTaskInterest,
  TaskInterestError,
} from '../../queries/task-interest';
import { useWithdrawTaskInterest } from '../../queries/task-withdrawal';
import { QueuePosition } from './TaskQueueStatus';

/**
 * A Candidate's place in the queue and the button that joins or leaves it.
 * `queue` is what the caller knows of it — Disponibile's row and its one
 * read of the places (#1133) — so nothing is asked here. By default one
 * stacked block. With `children` it hands its two halves to the caller
 * instead — what it says (`status`) and the button (`action`, null while
 * there is none) — so a Task row can put the text in its content and the
 * button at its end.
 */
export function TaskInterestControls({
  taskId,
  task,
  queue,
  children,
}: {
  taskId: number;
  task?: TaskPresentation;
  queue: OwnTaskQueue;
  children?: (parts: { status: ReactNode; action: ReactNode }) => ReactNode;
}) {
  const join = useExpressTaskInterest();
  const withdraw = useWithdrawTaskInterest();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act() {
    if (busy || join.isPending || withdraw.isPending) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (queue.status === 'pending') {
        await withdraw.mutateAsync(taskId);
        setMessage('Te-ai retras din lista de așteptare.');
      } else {
        const { position } = await join.mutateAsync(taskId);
        // Ruling R9: joining only ever queues.
        setMessage(`Te-ai înscris pe locul ${position} în lista de așteptare.`);
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
  /* One queue sentence (B21): right after a join or a withdrawal the receipt
     says it; otherwise the stage sentence names the place and the queue line
     adds only what it does not. */
  const place = (
    <>
      {task && !message && (
        <TaskStageSummary
          task={{
            ...task,
            candidature: queue.status
              ? { status: queue.status, position: queue.position }
              : null,
          }}
        />
      )}
      {!message && (
        <QueuePosition queue={queue} stageShown={task !== undefined} />
      )}
    </>
  );
  const action = queue.status !== 'selected' && (
    <Button
      variant="outline"
      className="min-h-11 min-w-11 whitespace-normal"
      disabled={busy || join.isPending || withdraw.isPending}
      onClick={act}
    >
      {busy
        ? 'Se salvează…'
        : queue.status === 'pending'
          ? 'Retrage înscrierea'
          : queue.status
            ? 'Înscrie-te din nou'
            : 'Vreau să particip'}
    </Button>
  );
  const receipt = (
    <>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
  if (children)
    return children({
      status: (
        <>
          {place}
          {receipt}
        </>
      ),
      action: action || null,
    });
  return (
    <div className="space-y-3">
      {place}
      {action}
      {receipt}
    </div>
  );
}
