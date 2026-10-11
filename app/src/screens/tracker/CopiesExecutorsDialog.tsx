import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { DirectExecutorSelector } from './DirectExecutorSelector';

/** The same words the server uses for `invalid_executors`. */
export const EXECUTORS_REQUIRED =
  'Alege câte un executor pentru fiecare exemplar.';

/**
 * The second step of n direct copies (spec 2026-10-11): one Executor per
 * copy, all required, a Member chosen for one copy not offered for another.
 * Mounted only while the step is on: its state starts afresh each time.
 * Full screen on a phone; Înapoi (or Escape) returns to the form with the
 * draft intact; a server refusal is shown here.
 */
export function CopiesExecutorsDialog({
  count,
  originGroupId,
  plural,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  count: number;
  originGroupId: number;
  plural: 'taskuri' | 'subtaskuri';
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (executorIds: string[]) => void;
}) {
  const [ids, setIds] = useState<(string | null)[]>(() =>
    Array.from({ length: count }, () => null),
  );
  const [missing, setMissing] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ids.some((id) => id === null)) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onConfirm(ids.filter((id): id is string => id !== null));
  }
  const shown = missing ? EXECUTORS_REQUIRED : error;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onBack();
      }}
    >
      <DialogContent fullScreenOnPhone className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              Executorii celor {count} {plural}
            </DialogTitle>
            <DialogDescription>{EXECUTORS_REQUIRED}</DialogDescription>
          </DialogHeader>
          <ol className="m-0 grid list-none gap-5 p-0">
            {ids.map((id, index) => (
              // The list is fixed at mount: the index is the copy's number.
              <li key={index} className="grid gap-1.5">
                <DirectExecutorSelector
                  label={`Exemplarul ${index + 1}`}
                  originGroupId={originGroupId}
                  value={id}
                  excludeIds={ids.filter(
                    (other, position): other is string =>
                      position !== index && other !== null,
                  )}
                  onChange={(next) => {
                    setIds((current) =>
                      current.map((value, position) =>
                        position === index ? next : value,
                      ),
                    );
                    setMissing(false);
                  }}
                  disabled={busy}
                />
              </li>
            ))}
          </ol>
          {shown && (
            <p role="alert" className="text-sm text-destructive">
              {shown}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onBack}
            >
              Înapoi
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Se creează…' : `Creează ${count} ${plural}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
