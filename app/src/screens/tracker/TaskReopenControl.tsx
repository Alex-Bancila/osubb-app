import { TaskActionSuccess } from './TaskActionSuccess';
import { useState } from 'react';
import { useTaskEvaluationCapability } from '../../queries/task-review';
import { useReopenTask } from '../../queries/task-reopen';
import type { TaskStatus } from './task-presentation';
import { TaskReasonDialog } from './TaskReasonDialog';

export function TaskReopenControl({
  taskId,
  status,
  kind,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [done, setDone] = useState(false);
  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    if (status !== 'in_progress') setDone(false);
  }
  if (done)
    return (
      <TaskActionSuccess>
        Taskul este în lucru. Istoricul și punctele au fost actualizate.
      </TaskActionSuccess>
    );
  if (
    capability.data !== true ||
    !['completed', 'unfulfilled'].includes(status) ||
    kind !== 'task'
  )
    return null;
  return <ReopenDialog taskId={taskId} onSuccess={() => setDone(true)} />;
}

function ReopenDialog({
  taskId,
  onSuccess,
}: {
  taskId: number;
  onSuccess: () => void;
}) {
  const mutation = useReopenTask();
  return (
    <TaskReasonDialog
      triggerLabel="Redeschide taskul"
      title="Redeschide taskul"
      description="Taskul revine în lucru pentru același Executor. Punctele evaluării sunt inversate în aceeași operațiune: un premiu se scade, iar o penalizare se restituie. Istoricul rămâne păstrat."
      field="reason"
      fieldLabel="Motiv (obligatoriu)"
      confirmLabel="Confirmă redeschiderea"
      failureMessage="Nu am putut redeschide taskul."
      isPending={mutation.isPending}
      onConfirm={(reason) => mutation.mutateAsync({ taskId, reason })}
      onSuccess={onSuccess}
    />
  );
}
