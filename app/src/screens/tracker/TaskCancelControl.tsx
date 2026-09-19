import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useCancelTask } from '../../queries/task-cancel';
import type { TaskStatus } from './task-presentation';

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
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (!canManage || ['completed', 'unfulfilled', 'cancelled'].includes(status))
    return null;
  return (
    <section aria-label="Anulează taskul">
      {open ? (
        <TaskCancelForm
          taskId={taskId}
          umbrella={kind === 'umbrella'}
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
          Anulează taskul
        </Button>
      )}
      {done && (
        <p role="status">Taskul este anulat. Istoricul rămâne păstrat.</p>
      )}
    </section>
  );
}
export function TaskCancelForm({
  taskId,
  onCancel,
  onSuccess,
  umbrella = false,
}: {
  taskId: number;
  onCancel: () => void;
  onSuccess: () => void;
  umbrella?: boolean;
}) {
  const id = useId();
  const mutation = useCancelTask();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!note.trim()) {
      setError('Scrie motivul anulării.');
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
          : 'Nu am putut anula taskul.',
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Anulează taskul"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h3 className="font-semibold">Anulează taskul</h3>
      <p className="text-sm">
        Anularea păstrează istoricul publicat, evaluările și atribuirile. Taskul
        nu mai poate fi lucrat sau evaluat.
      </p>
      {umbrella && (
        <p>
          Toate Subtaskurile neterminale vor fi anulate cu același motiv.
          Subtaskurile deja încheiate rămân păstrate.
        </p>
      )}
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
          {mutation.isPending ? 'Se trimite…' : 'Confirmă anularea'}
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
