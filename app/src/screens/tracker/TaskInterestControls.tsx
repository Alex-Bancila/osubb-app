import type { TaskPresentation } from './task-presentation';
import { TaskStageSummary } from './TaskStageSummary';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { useTaskQueue } from '../../queries/task-queue';
import {
  useExpressTaskInterest,
  TaskInterestError,
} from '../../queries/task-interest';
import { useWithdrawTaskInterest } from '../../queries/task-withdrawal';
import { QueuePosition } from './TaskQueueStatus';

/**
 * A Candidate's place in the queue and the button that joins or leaves it.
 * By default one stacked block (the details sheet). With `children` it hands
 * its two halves to the caller instead — what it says (`status`) and the
 * button (`action`, null while there is none) — so a Task row can put the
 * text in its content and the button at its end.
 */
export function TaskInterestControls({
  taskId,
  task,
  children,
}: {
  taskId: number;
  task?: TaskPresentation;
  children?: (parts: { status: ReactNode; action: ReactNode }) => ReactNode;
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
  if (queue.isPending) {
    const loading = <p role="status">Se încarcă înscrierea…</p>;
    return children ? children({ status: loading, action: null }) : loading;
  }
  if (queue.isError) {
    const failed = (
      <div role="alert">
        <p>Nu am putut încărca înscrierea.</p>
        <Button
          variant="outline"
          // Above a row's stretched open button.
          className="relative z-10 min-h-11 min-w-11"
          onClick={() => queue.refetch()}
        >
          Reîncarcă înscrierea
        </Button>
      </div>
    );
    return children ? children({ status: failed, action: null }) : failed;
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
            candidature: queue.data.status
              ? { status: queue.data.status, position: queue.data.position }
              : null,
          }}
        />
      )}
      {!message && (
        <QueuePosition queue={queue.data} stageShown={task !== undefined} />
      )}
    </>
  );
  const action = queue.data.status !== 'selected' && (
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
