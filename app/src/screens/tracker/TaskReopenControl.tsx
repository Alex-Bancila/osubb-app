import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useTaskEvaluationCapability } from '../../queries/task-review';
import { useReopenTask } from '../../queries/task-reopen';
import type { TaskStatus } from './task-presentation';

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
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (
    capability.data !== true ||
    !['completed', 'unfulfilled'].includes(status) ||
    kind !== 'task'
  )
    return null;
  return (
    <section aria-label="Redeschide taskul">
      {open ? (
        <TaskReopenForm
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
          Redeschide taskul
        </Button>
      )}
      {done && (
        <p role="status">
          Taskul este în lucru. Istoricul și punctele au fost actualizate.
        </p>
      )}
    </section>
  );
}
export function TaskReopenForm({
  taskId,
  onCancel,
  onSuccess,
}: {
  taskId: number;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const id = useId();
  const mutation = useReopenTask();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!note.trim()) {
      setError('Scrie motivul redeschiderii.');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ taskId, reason: note.trim() });
      onSuccess();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Nu am putut redeschide taskul.',
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Redeschide taskul"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h3 className="font-semibold">Redeschide taskul</h3>
      <p className="text-sm">
        Taskul revine în lucru pentru același Executor. Punctele evaluării sunt
        inversate în aceeași operațiune: un premiu se scade, iar o penalizare se
        restituie. Istoricul rămâne păstrat.
      </p>
      <label className="block font-medium" htmlFor={id}>
        Motiv (obligatoriu)
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
          {mutation.isPending ? 'Se trimite…' : 'Confirmă redeschiderea'}
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
