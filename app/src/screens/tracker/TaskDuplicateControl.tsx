import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import {
  taskDuplicationErrorMessage,
  useDuplicateTask,
} from '../../queries/task-duplication';

export function TaskDuplicateControl({
  taskId,
  onDuplicated,
}: {
  taskId: number;
  onDuplicated: (id: number) => void;
}) {
  const mutation = useDuplicateTask();
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  if (!open)
    return (
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        Duplică
      </Button>
    );
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label="Duplică taskul"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        const instant = bucharestWallTimeToIso(deadline);
        if (!instant) {
          setError('Alege un termen-limită valid, în ora Bucureștiului.');
          return;
        }
        submitting.current = true;
        setPending(true);
        setError(null);
        try {
          const clone = await mutation.mutateAsync({
            taskId,
            deadline: instant,
          });
          onDuplicated(clone.id);
        } catch (failure) {
          setError(taskDuplicationErrorMessage(failure));
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Copia va avea un termen nou și va păstra legătura cu acest task.
        Executorul și rezultatele nu se copiază.
      </p>
      <label className="block space-y-1">
        <span className="font-semibold">Termen nou (ora Bucureștiului)</span>
        <input
          autoFocus
          required
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          disabled={pending}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">Se duplică taskul…</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={pending}>
          Creează copia
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Renunță
        </Button>
      </div>
    </form>
  );
}
