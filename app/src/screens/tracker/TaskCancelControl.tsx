import { TaskActionSuccess } from './TaskActionSuccess';
import { useReceiptTurn } from './receipt-turn';
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { useCancelTask } from '../../queries/task-cancel';
import type { TaskStatus } from './task-presentation';
import { TaskReasonDialog } from './TaskReasonDialog';
import type { MenuDialog } from './menu-dialog';
import { canCancelTask } from './task-menu-actions';

export function TaskCancelControl({
  taskId,
  status,
  kind,
  canManage,
  menu,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  canManage: boolean;
  /** The action sits in the details sheet's menu, which opens the pop-up. */
  menu?: MenuDialog;
}) {
  const [done, setDone] = useState(false);
  // Only the latest receipt in the sheet shows (Audit D-16).
  const turn = useReceiptTurn();
  if (done)
    return !turn.current ? null : (
      <TaskActionSuccess>
        Taskul este anulat. Istoricul rămâne păstrat.
      </TaskActionSuccess>
    );
  if (!canCancelTask(status, canManage)) return null;
  return (
    <CancelDialog
      taskId={taskId}
      umbrella={kind === 'umbrella'}
      menu={menu}
      onSuccess={() => {
        setDone(true);
        turn.claim();
      }}
    />
  );
}

function CancelDialog({
  taskId,
  umbrella,
  onSuccess,
  menu,
}: {
  taskId: number;
  umbrella: boolean;
  onSuccess: () => void;
  menu: MenuDialog | undefined;
}) {
  const mutation = useCancelTask();
  return (
    <TaskReasonDialog
      triggerLabel="Anulează taskul"
      triggerIcon={Ban}
      menu={menu}
      title="Anulează taskul"
      description="Anularea păstrează istoricul publicat, evaluările și atribuirile. Taskul nu mai poate fi lucrat sau evaluat."
      field="reason"
      fieldLabel="Motiv"
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
