import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

export type DeleteDialogControls = {
  /** Closes the pop-up; `deleted` keeps focus off the trigger, which is gone. */
  close: (deleted?: boolean) => void;
  /** While a command runs the pop-up stays open (Escape and outside do nothing). */
  setBusy: (busy: boolean) => void;
};

/**
 * "Șterge definitiv" (#1017): one destructive trigger, set apart from Editează,
 * and a pop-up whose body exists only while it is open — so the preview it
 * reads is fresh on every opening and nothing is read for a closed one.
 *
 * Where the action lives in a menu instead, pass `open` and `onOpenChange`:
 * no trigger is drawn, the menu item opens the pop-up, and `returnFocus`
 * says where focus goes when it closes without a delete.
 */
export function DeleteForGoodDialog({
  title,
  disabled = false,
  compact = false,
  className,
  open: controlledOpen,
  onOpenChange,
  returnFocus,
  children,
}: {
  /** The pop-up's name: the question it asks. */
  title: string;
  disabled?: boolean;
  /** In a crowded row: a smaller trigger, the bin alone under 640 px. */
  compact?: boolean;
  /** Placement of the trigger in its row (e.g. pushed to the row's end). */
  className?: string;
  /** Controlled, for an action in a menu: the pop-up draws no trigger. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Controlled: the element (the menu's button) that takes focus back. */
  returnFocus?: (() => HTMLElement | null) | undefined;
  children: (controls: DeleteDialogControls) => ReactNode;
}) {
  const controlled = controlledOpen !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  // A pop-up its caller opens starts afresh too, like one the trigger opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDeleted(false);
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (next) setDeleted(false);
        setOpen(next);
      }}
    >
      {!controlled && (
        <Button
          type="button"
          variant="destructive"
          size={compact ? 'sm' : undefined}
          className={cn(compact ? 'gap-1.5' : 'gap-2', className)}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {compact ? (
            <span className="max-sm:sr-only">Șterge definitiv</span>
          ) : (
            'Șterge definitiv'
          )}
        </Button>
      )}
      {/* After a delete the trigger is gone and the receipt takes focus. */}
      <DialogContent
        showCloseButton={!busy}
        finalFocus={() => (deleted ? false : (returnFocus?.() ?? true))}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* The popup unmounts once closed, so each opening starts afresh. */}
        {children({
          close: (wasDeleted = false) => {
            setDeleted(wasDeleted);
            setBusy(false);
            setOpen(false);
          },
          setBusy,
        })}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What goes with the object, one fact per row: the figure first, so the eye
 * runs down the numbers. Sized to its rows; absent when there is nothing.
 */
export function Consequences({
  label,
  items,
}: {
  label: string;
  items: readonly ReactNode[];
}) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={label}
      data-slot="delete-consequences"
      className="m-0 grid list-none gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm"
    >
      {items.map((item, index) => (
        <li key={index} className="flex min-w-0 items-baseline gap-2">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 translate-y-[-0.1em] rounded-full bg-destructive/70"
          />
          <span className="min-w-0 wrap-break-word">{item}</span>
        </li>
      ))}
    </ul>
  );
}
