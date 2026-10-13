import { useState, type FormEvent, type ReactNode } from 'react';
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

/** What one copy's picker is handed when the caller draws its own. */
export type CopiesPickerSlot = {
  /** The copy's number, from 0. */
  index: number;
  value: string | null;
  /** The other copies' choices, empty when repeats are allowed. */
  excludeIds: readonly string[];
  disabled: boolean;
  onChange: (id: string | null) => void;
};

/**
 * The second step of n copies (spec 2026-10-11): one person per copy, all
 * required. For n direct Tasks (Part B) a Member chosen for one copy is not
 * offered for another; for n finished Tasks (Part E) the caller allows
 * repeats and hands over its own volunteer picker, title and labels. Mounted
 * only while the step is on: its state starts afresh each time. Full screen
 * on a phone; Înapoi (or Escape) returns to the form with the draft intact; a
 * server refusal is shown here.
 */
export function CopiesExecutorsDialog({
  count,
  originGroupId,
  plural = 'taskuri',
  busy,
  error,
  onBack,
  onConfirm,
  title,
  description = EXECUTORS_REQUIRED,
  confirmLabel,
  busyLabel = 'Se creează…',
  allowRepeats = false,
  renderPicker,
}: {
  count: number;
  /** The Group the default picker (an Executor) reads; unused with `renderPicker`. */
  originGroupId?: number;
  plural?: 'taskuri' | 'subtaskuri';
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (executorIds: string[]) => void;
  /** Default: "Executorii celor n taskuri". */
  title?: string;
  /** Also the line shown while a copy still has nobody. */
  description?: string;
  /** Default: "Creează n taskuri". */
  confirmLabel?: string;
  busyLabel?: string;
  /** The same person may be chosen for several copies. */
  allowRepeats?: boolean;
  /** One picker per copy, in place of the Executor picker. */
  renderPicker?: (slot: CopiesPickerSlot) => ReactNode;
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
  const shown = missing ? description : error;
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
              {title ?? `Executorii celor ${count} ${plural}`}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ol className="m-0 grid list-none gap-5 p-0">
            {ids.map((id, index) => {
              const slot: CopiesPickerSlot = {
                index,
                value: id,
                excludeIds: allowRepeats
                  ? []
                  : ids.filter(
                      (other, position): other is string =>
                        position !== index && other !== null,
                    ),
                disabled: busy,
                onChange: (next) => {
                  setIds((current) =>
                    current.map((value, position) =>
                      position === index ? next : value,
                    ),
                  );
                  setMissing(false);
                },
              };
              return (
                // The list is fixed at mount: the index is the copy's number.
                <li key={index} className="grid gap-1.5">
                  {renderPicker ? (
                    renderPicker(slot)
                  ) : originGroupId === undefined ? null : (
                    <DirectExecutorSelector
                      label={`Exemplarul ${index + 1}`}
                      originGroupId={originGroupId}
                      value={slot.value}
                      excludeIds={slot.excludeIds}
                      onChange={slot.onChange}
                      disabled={slot.disabled}
                    />
                  )}
                </li>
              );
            })}
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
              {busy
                ? busyLabel
                : (confirmLabel ?? `Creează ${count} ${plural}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
