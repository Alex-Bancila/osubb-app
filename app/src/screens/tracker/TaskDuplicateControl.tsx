import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import {
  taskDuplicationErrorMessage,
  useDuplicateTask,
} from '../../queries/task-duplication';

/** "Duplică" asks for one thing, the new deadline, in a small pop-up. */
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
  // After a copy opens, focus belongs to the details heading, not this button.
  const duplicated = useRef(false);
  async function submit(event: FormEvent) {
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
      const clone = await mutation.mutateAsync({ taskId, deadline: instant });
      duplicated.current = true;
      setOpen(false);
      onDuplicated(clone.id);
    } catch (failure) {
      setError(taskDuplicationErrorMessage(failure));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        Duplică
      </Button>
      <DialogContent finalFocus={() => !duplicated.current}>
        <form
          className="grid gap-4"
          aria-label="Duplică taskul"
          noValidate
          onSubmit={submit}
        >
          <DialogHeader>
            <DialogTitle>Duplică taskul</DialogTitle>
            <DialogDescription>
              Copia va avea un termen nou și va păstra legătura cu acest task.
              Executorul și rezultatele nu se copiază.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1">
            <span className="font-semibold">
              Termen nou (ora Bucureștiului)
            </span>
            <input
              required
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              disabled={pending}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {pending && <p role="status">Se duplică taskul…</p>}
          <DialogFooter>
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
            <Button type="submit" className="min-h-11" disabled={pending}>
              Creează copia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
