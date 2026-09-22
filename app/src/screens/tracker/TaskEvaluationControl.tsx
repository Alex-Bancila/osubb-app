import { TaskActionSuccess } from './TaskActionSuccess';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  useEvaluateTask,
  useTaskEvaluationCapability,
} from '../../queries/task-review';
import type { TaskStatus } from './task-presentation';
import { EvaluationFields } from '../../components/tasks/EvaluationFields';

export function TaskEvaluationControl({
  taskId,
  status,
  kind,
  executorName,
  overdue = false,
  hasExecutor = false,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  executorName: string | null;
  overdue?: boolean;
  /** mark_task_unfulfilled refuses a Task nobody is working on. */
  hasExecutor?: boolean;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const canUnfulfilled =
    overdue &&
    hasExecutor &&
    ['todo', 'in_progress', 'in_review'].includes(status);
  const [outcome, setOutcome] = useState<'completed' | 'unfulfilled'>(
    'completed',
  );
  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    if (status !== outcome) setDone(false);
  }
  if (done)
    return (
      <TaskActionSuccess>
        Evaluarea a fost salvată. Punctele Executorului au fost actualizate.
      </TaskActionSuccess>
    );
  if (
    capability.data !== true ||
    kind !== 'task' ||
    (status !== 'in_review' && !canUnfulfilled)
  )
    return null;
  return (
    <section aria-label="Evaluare task" className="space-y-3">
      {open ? (
        <EvaluationForm
          taskId={taskId}
          outcome={outcome}
          executorName={executorName}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
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
              Evaluează taskul
            </Button>
          )}
          {canUnfulfilled && (
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
}: {
  taskId: number;
  executorName: string | null;
  onCancel: () => void;
  onSuccess: () => void;
  outcome?: 'completed' | 'unfulfilled';
}) {
  const mutation = useEvaluateTask();
  return (
    <EvaluationFields
      outcome={outcome}
      executorName={executorName}
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
