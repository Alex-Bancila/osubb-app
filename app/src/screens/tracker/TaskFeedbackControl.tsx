import { TaskActionSuccess } from './TaskActionSuccess';
import { useState } from 'react';
import { useTaskEvaluationCapability } from '../../queries/task-review';
import { useReturnTaskToProgress } from '../../queries/task-feedback';
import type { TaskStatus } from './task-presentation';
import { TaskReasonDialog } from './TaskReasonDialog';

export function TaskFeedbackControl({
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
        Taskul este în lucru, cu feedback de aplicat. Executorul primește nota.
      </TaskActionSuccess>
    );
  if (capability.data !== true || status !== 'in_review' || kind !== 'task')
    return null;
  return <FeedbackDialog taskId={taskId} onSuccess={() => setDone(true)} />;
}

function FeedbackDialog({
  taskId,
  onSuccess,
}: {
  taskId: number;
  onSuccess: () => void;
}) {
  const mutation = useReturnTaskToProgress();
  return (
    <TaskReasonDialog
      triggerLabel="Trimite înapoi în lucru"
      title="Trimite înapoi în lucru"
      description="Taskul revine în lucru cu feedback de aplicat. Nota rămâne în istoric și ajunge la Executor."
      field="note"
      fieldLabel="Notă pentru Executor (obligatoriu)"
      confirmLabel="Confirmă feedbackul"
      failureMessage="Nu am putut trimite feedbackul."
      isPending={mutation.isPending}
      onConfirm={(note) => mutation.mutateAsync({ taskId, note })}
      onSuccess={onSuccess}
    />
  );
}
