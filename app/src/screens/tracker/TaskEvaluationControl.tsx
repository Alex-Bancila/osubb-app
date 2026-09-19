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
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  executorName: string | null;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    if (status !== 'completed') setDone(false);
  }
  if (done)
    return (
      <TaskActionSuccess>
        Evaluarea a fost salvată. Punctele Executorului au fost actualizate.
      </TaskActionSuccess>
    );
  if (capability.data !== true || status !== 'in_review' || kind !== 'task')
    return null;
  return (
    <section aria-label="Evaluare task" className="space-y-3">
      {open ? (
        <EvaluationForm
          taskId={taskId}
          executorName={executorName}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : (
        <Button
          className="min-h-11"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Evaluează taskul
        </Button>
      )}
    </section>
  );
}

export function EvaluationForm({
  taskId,
  executorName,
  onCancel,
  onSuccess,
}: {
  taskId: number;
  executorName: string | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const mutation = useEvaluateTask();
  return (
    <EvaluationFields
      executorName={executorName}
      onCancel={onCancel}
      onSuccess={onSuccess}
      isPending={mutation.isPending}
      onEvaluate={(values) => mutation.mutateAsync({ taskId, ...values })}
    />
  );
}
