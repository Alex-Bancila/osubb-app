import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { Textarea } from '../../components/ui/input';
import {
  fieldForReason as noteFields,
  noteSchema,
} from '../../lib/schemas/note';
import {
  fieldForReason as reasonFields,
  fieldForRejectionReason,
  reasonSchema,
  rejectionReasonSchema,
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
import type { MenuDialog } from './menu-dialog';

/**
 * One small pop-up for the Task actions that need a written reason: send work
 * back with feedback (a `note`), reopen or cancel (a `reason`). The text is
 * required and at most 1000 characters (ruling R8); a refusal stays inside the
 * pop-up, under the field, with the text kept, so the member can fix it.
 *
 * It draws its own trigger button, unless `menu` hands it the open state of
 * an action that lives in a menu.
 */
export function TaskReasonDialog({
  triggerLabel,
  triggerIcon: TriggerIcon,
  triggerSize,
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
  menu,
}: {
  /** The trigger's words; its accessible name is all of them, hidden or not. */
  triggerLabel?: ReactNode;
  triggerIcon?: LucideIcon;
  triggerSize?: 'default' | 'sm';
  title: string;
  description: ReactNode;
  children?: ReactNode;
  /**
   * Which text the command records: a decision note, a reason, or the reason
   * of a rejection (spec 2026-10-11) — a `reason` under its own reason codes.
   */
  field: 'note' | 'reason' | 'rejection';
  fieldLabel: string;
  confirmLabel: string;
  failureMessage: string;
  isPending: boolean;
  onConfirm: (text: string) => Promise<unknown>;
  /** Runs after the command succeeds; the caller shows (and focuses) a receipt. */
  onSuccess: () => void;
  /** Opened from a menu item: no trigger of its own. */
  menu?: MenuDialog | undefined;
}) {
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = menu ? menu.open : ownOpen;
  const setOpen = menu ? menu.onOpenChange : setOwnOpen;
  const [text, setText] = useState('');
  const key = field === 'note' ? 'note' : 'reason';
  const form = useFormValidation(
    field === 'note'
      ? noteSchema
      : field === 'rejection'
        ? rejectionReasonSchema
        : reasonSchema,
    field === 'note' ? { note: text } : { reason: text },
    field === 'note'
      ? noteFields
      : field === 'rejection'
        ? fieldForRejectionReason
        : reasonFields,
  );
  const submitting = useRef(false);
  const succeeded = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    // The pop-up may sit inside another form (an edit sheet in review, spec
    // 2026-10-11): its submit reaches that form through the portal in React's
    // tree, and must not submit it.
    event.stopPropagation();
    if (submitting.current) return;
    const values = form.validate();
    if (!values) return;
    submitting.current = true;
    succeeded.current = false;
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
      {!menu && (
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size={triggerSize}
              className="min-h-11"
            />
          }
        >
          {TriggerIcon && <TriggerIcon aria-hidden="true" />}
          {triggerLabel}
        </DialogTrigger>
      )}
      {/* After success the trigger is gone and the receipt takes focus;
          otherwise focus goes back to the trigger (the menu's button). */}
      <DialogContent
        finalFocus={() =>
          succeeded.current ? false : (menu?.returnFocus() ?? true)
        }
      >
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={id}>
              {fieldLabel}
            </label>
            <Textarea
              id={id}
              required
              aria-required="true"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={isPending}
              {...form.field(key)}
            />
            <FieldError {...form.errorProps(key)} />
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
