import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  fieldForReason as noteFields,
  noteSchema,
} from '../../lib/schemas/note';
import {
  fieldForReason as reasonFields,
  reasonSchema,
} from '../../lib/schemas/reason';
import { useFormValidation } from '../../lib/use-form-validation';
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
 * back with feedback (a `note`), reopen or cancel (a `reason`). The text is
 * required and at most 1000 characters (ruling R8); a refusal stays inside the
 * pop-up, under the field, with the text kept, so the member can fix it.
 */
export function TaskReasonDialog({
  triggerLabel,
  title,
  description,
  children,
  field,
  fieldLabel,
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
  /** Which text the command records: a decision note or a reason. */
  field: 'note' | 'reason';
  fieldLabel: string;
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
  const form = useFormValidation(
    field === 'note' ? noteSchema : reasonSchema,
    field === 'note' ? { note: text } : { reason: text },
    field === 'note' ? noteFields : reasonFields,
  );
  const submitting = useRef(false);
  const succeeded = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const values = form.validate();
    if (!values) return;
    submitting.current = true;
    try {
      await onConfirm('note' in values ? values.note : values.reason);
      succeeded.current = true;
      setOpen(false);
      setText('');
      onSuccess();
    } catch (failure) {
      form.fail(failure, failureMessage);
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
        form.reset();
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
              {...form.field(field)}
            />
            <FieldError {...form.errorProps(field)} />
          </div>
          <FieldError>{form.formError}</FieldError>
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
