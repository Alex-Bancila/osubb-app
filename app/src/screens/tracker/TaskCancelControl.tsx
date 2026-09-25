import { TaskActionSuccess } from './TaskActionSuccess';
import { useState } from 'react';
import { useCancelTask } from '../../queries/task-cancel';
import type { TaskStatus } from './task-presentation';
import { TaskReasonDialog } from './TaskReasonDialog';

export function TaskCancelControl({
  taskId,
  status,
  kind,
  canManage,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  canManage: boolean;
}) {
  const [done, setDone] = useState(false);
  if (done)
    return (
      <TaskActionSuccess>
        Taskul este anulat. Istoricul rămâne păstrat.
      </TaskActionSuccess>
    );
  if (!canManage || ['completed', 'unfulfilled', 'cancelled'].includes(status))
    return null;
  return (
    <CancelDialog
      taskId={taskId}
      umbrella={kind === 'umbrella'}
      onSuccess={() => setDone(true)}
    />
  );
}

function CancelDialog({
  taskId,
  umbrella,
  onSuccess,
}: {
  taskId: number;
  umbrella: boolean;
  onSuccess: () => void;
}) {
  const mutation = useCancelTask();
  return (
    <TaskReasonDialog
      triggerLabel="Anulează taskul"
      title="Anulează taskul"
      description="Anularea păstrează istoricul publicat, evaluările și atribuirile. Taskul nu mai poate fi lucrat sau evaluat."
      field="reason"
      fieldLabel="Motiv (obligatoriu)"
      confirmLabel="Confirmă anularea"
      failureMessage="Nu am putut anula taskul."
      isPending={mutation.isPending}
      onConfirm={(reason) => mutation.mutateAsync({ taskId, reason })}
      onSuccess={onSuccess}
    >
      {umbrella && (
        <p>
          Toate Subtaskurile neterminale vor fi anulate cu același motiv.
          Subtaskurile deja încheiate rămân păstrate.
        </p>
      )}
    </TaskReasonDialog>
  );
}
