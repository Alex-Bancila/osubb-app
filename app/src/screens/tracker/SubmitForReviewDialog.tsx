import { useId, useRef, useState, type FormEvent } from 'react';
import {
  AttachedLinkFields,
  type AttachedLinkValue,
} from '../../components/attached-link/AttachedLinkFields';
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
import { FieldError } from '../../components/ui/field';
import { charLength } from '../../lib/normalize';
import { fieldForReason, submissionSchema } from '../../lib/schemas/submission';
import { useFormValidation } from '../../lib/use-form-validation';
import type { TaskSubmission } from '../../queries/task-progress';

const NOTE_LIMIT = 1000;
const EMPTY_LINK: AttachedLinkValue = { label: '', url: '' };

/**
 * "Trimite la verificare" (ruling R7): the Executor may leave the reviewer a
 * Submission Note and one Attached Link, both optional. The draft is checked
 * by #674's schema before any request; a refusal from
 * `submit_task_for_review` lands under the field it belongs to, with the
 * draft kept, so the member can fix it and try again.
 */
export function SubmitForReviewDialog({
  pending,
  onSubmit,
  onSuccess,
}: {
  pending: boolean;
  onSubmit: (submission: TaskSubmission) => Promise<unknown>;
  /** Runs after the command succeeds; the caller shows (and focuses) a receipt. */
  onSuccess: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<AttachedLinkValue>(EMPTY_LINK);
  const form = useFormValidation(
    submissionSchema,
    { note, link },
    fieldForReason,
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
      await onSubmit({
        note: values.note,
        linkLabel: values.link.label,
        linkUrl: values.link.url,
      });
      succeeded.current = true;
      setOpen(false);
      setNote('');
      setLink(EMPTY_LINK);
      onSuccess();
    } catch (failure) {
      form.fail(failure, 'Nu am putut trimite taskul. Încearcă din nou.');
    } finally {
      submitting.current = false;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) succeeded.current = false;
        form.reset();
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            className="min-h-11 min-w-11 w-full whitespace-normal sm:w-auto"
            disabled={pending}
          />
        }
      >
        Trimite la verificare
      </DialogTrigger>
      {/* After success the trigger is gone and the card's receipt takes
          focus; otherwise focus goes back to the trigger. */}
      <DialogContent
        finalFocus={() => !succeeded.current}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Trimite la verificare</DialogTitle>
            <DialogDescription>
              Taskul trece în verificare. Dacă vrei, lasă o notă și un link
              pentru cine îl verifică.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor={`${id}-note`}>
              Notă pentru verificator (opțional)
            </label>
            <textarea
              id={`${id}-note`}
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              {...form.field('note', `${id}-note-help`)}
            />
            <p
              id={`${id}-note-help`}
              className="text-xs text-muted-foreground tabular-nums"
            >
              {charLength(note.trim())} / {NOTE_LIMIT} caractere
            </p>
            <FieldError {...form.errorProps('note')} />
          </div>
          <fieldset disabled={pending} className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              Link pentru verificator (opțional)
            </legend>
            <AttachedLinkFields
              name="link"
              value={link}
              onChange={setLink}
              form={form}
            />
          </fieldset>
          <FieldError>{form.formError}</FieldError>
          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                />
              }
            >
              Renunță
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={pending}>
              {pending ? 'Se trimite…' : 'Trimite la verificare'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
