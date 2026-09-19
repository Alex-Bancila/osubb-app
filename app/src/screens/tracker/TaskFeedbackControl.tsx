import { TaskActionSuccess } from './TaskActionSuccess';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useTaskEvaluationCapability } from '../../queries/task-review';
import { useReturnTaskToProgress } from '../../queries/task-feedback';
import type { TaskStatus } from './task-presentation';

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
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
  }, [status]);
  if (done)
    return (
      <TaskActionSuccess>
        Taskul este în lucru, cu feedback de aplicat. Executorul primește nota.
      </TaskActionSuccess>
    );
  if (capability.data !== true || status !== 'in_review' || kind !== 'task')
    return null;
  return (
    <section aria-label="Feedback pentru Executor">
      {open ? (
        <TaskFeedbackForm
          taskId={taskId}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Trimite înapoi în lucru
        </Button>
      )}
    </section>
  );
}
export function TaskFeedbackForm({
  taskId,
  onCancel,
  onSuccess,
}: {
  taskId: number;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const id = useId();
  const mutation = useReturnTaskToProgress();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!note.trim()) {
      setError('Scrie o notă pentru Executor.');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ taskId, note: note.trim() });
      onSuccess();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Nu am putut trimite feedbackul.',
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Trimite feedback"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h3 className="font-semibold">Trimite înapoi în lucru</h3>
      <p className="text-sm">
        Taskul revine în lucru cu feedback de aplicat. Nota rămâne în istoric și
        ajunge la Executor.
      </p>
      <label className="block font-medium" htmlFor={id}>
        Notă pentru Executor (obligatoriu)
      </label>
      <textarea
        id={id}
        required
        rows={4}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={mutation.isPending}
        className="w-full rounded-md border border-input bg-background p-3"
      />
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          className="min-h-11"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Se trimite…' : 'Confirmă feedbackul'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Înapoi
        </Button>
      </div>
    </form>
  );
}
