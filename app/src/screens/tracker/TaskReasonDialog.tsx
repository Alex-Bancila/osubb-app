import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';

/**
 * One small pop-up for the Task actions that need a written reason: send work
 * back with feedback, reopen, cancel. The text is required; a refusal stays
 * inside the pop-up with the text kept, so the member can fix it and retry.
 */
export function TaskReasonDialog({
  triggerLabel,
  title,
  description,
  children,
  fieldLabel,
  requiredMessage,
  confirmLabel,
  failureMessage,
  isPending,
  onConfirm,
  onSuccess,
}: {
  triggerLabel: string;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  fieldLabel: string;
  requiredMessage: string;
  confirmLabel: string;
  failureMessage: string;
  isPending: boolean;
  onConfirm: (text: string) => Promise<unknown>;
  /** Runs after the command succeeds; the caller shows (and focuses) a receipt. */
  onSuccess: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const succeeded = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!text.trim()) {
      setError(requiredMessage);
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await onConfirm(text.trim());
      succeeded.current = true;
      setOpen(false);
      setText('');
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failureMessage);
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        if (next) succeeded.current = false;
        setError(null);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="outline" className="min-h-11" />}
      >
        {triggerLabel}
      </DialogTrigger>
      {/* After success the trigger is gone and the receipt takes focus;
          otherwise focus goes back to the trigger. */}
      <DialogContent finalFocus={() => !succeeded.current}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <div className="grid gap-2">
            <label className="font-medium" htmlFor={id}>
              {fieldLabel}
            </label>
            <textarea
              id={id}
              required
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-input bg-background p-3"
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={isPending}
                />
              }
            >
              Renunță
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={isPending}>
              {isPending ? 'Se trimite…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
