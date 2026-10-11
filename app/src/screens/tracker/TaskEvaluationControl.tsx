import { TaskActionSuccess } from './TaskActionSuccess';
import { useReceiptTurn } from './receipt-turn';
import { useImperativeHandle, useState, type Ref } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  useEvaluateTask,
  useTaskEvaluationCapability,
} from '../../queries/task-review';
import type { TaskStatus } from './task-presentation';
import { EvaluationFields } from '../../components/tasks/EvaluationFields';
import { unfulfilledAllowed } from './task-menu-actions';

/** What the details sheet's menu may ask of the control. */
export type TaskEvaluationActions = {
  /** Opens the form that scores the Task as Nerealizat. */
  markUnfulfilled: () => void;
};

export function TaskEvaluationControl({
  taskId,
  status,
  kind,
  executorName,
  overdue = false,
  hasExecutor = false,
  groupId,
  unfulfilledInMenu = false,
  actions,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  executorName: string | null;
  overdue?: boolean;
  /** mark_task_unfulfilled refuses a Task nobody is working on. */
  hasExecutor?: boolean;
  /** The Task's Group: the rating guide opens on its list (#986). */
  groupId?: number | null;
  /**
   * Marchează nerealizat is an item of the details sheet's menu, which opens
   * the form through `actions`: the control draws no button for it.
   */
  unfulfilledInMenu?: boolean;
  actions?: Ref<TaskEvaluationActions>;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  // Only the latest receipt in the sheet shows (Audit D-16).
  const turn = useReceiptTurn();
  const canUnfulfilled = unfulfilledAllowed({
    status,
    kind,
    overdue,
    hasExecutor,
  });
  const [outcome, setOutcome] = useState<'completed' | 'unfulfilled'>(
    'completed',
  );
  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    if (status !== outcome) setDone(false);
  }
  const offered =
    capability.data === true &&
    kind === 'task' &&
    (status === 'in_review' || canUnfulfilled);
  useImperativeHandle(
    actions,
    () => ({
      markUnfulfilled: () => {
        if (!offered || !canUnfulfilled) return;
        setOutcome('unfulfilled');
        setOpen(true);
        setDone(false);
      },
    }),
    [offered, canUnfulfilled],
  );
  if (done)
    return !turn.current ? null : (
      <TaskActionSuccess>
        Evaluarea a fost salvată. Punctele Executorului au fost actualizate.
      </TaskActionSuccess>
    );
  if (!offered) return null;
  // Its only action is in the menu: nothing to draw until the form opens.
  if (!open && unfulfilledInMenu && status !== 'in_review') return null;
  return (
    <section aria-label="Evaluare task" className="space-y-3">
      {open ? (
        <EvaluationForm
          taskId={taskId}
          outcome={outcome}
          executorName={executorName}
          groupId={groupId}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
            turn.claim();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'in_review' && (
            <Button
              className="min-h-11"
              onClick={() => {
                setOutcome('completed');
                setOpen(true);
                setDone(false);
              }}
            >
              <ClipboardCheck aria-hidden="true" />
              Evaluează taskul
            </Button>
          )}
          {canUnfulfilled && !unfulfilledInMenu && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => {
                setOutcome('unfulfilled');
                setOpen(true);
                setDone(false);
              }}
            >
              Marchează nerealizat
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function EvaluationForm({
  taskId,
  executorName,
  onCancel,
  onSuccess,
  outcome = 'completed',
  groupId,
}: {
  taskId: number;
  executorName: string | null;
  groupId?: number | null;
  onCancel: () => void;
  onSuccess: () => void;
  outcome?: 'completed' | 'unfulfilled';
}) {
  const mutation = useEvaluateTask();
  return (
    <EvaluationFields
      outcome={outcome}
      executorName={executorName}
      groupId={groupId}
      onCancel={onCancel}
      onSuccess={onSuccess}
      isPending={mutation.isPending}
      onEvaluate={(values) =>
        mutation.mutateAsync({
          taskId,
          ...values,
          ...(outcome === 'unfulfilled' ? { outcome } : {}),
        })
      }
    />
  );
}
