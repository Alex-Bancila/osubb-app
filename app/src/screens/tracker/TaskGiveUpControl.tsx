import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { fieldForReason, reasonSchema } from '../../lib/schemas/reason';
import { useFormValidation } from '../../lib/use-form-validation';
import { useGiveUpTask } from '../../queries/task-give-up';
import { useReceiptTurn } from './receipt-turn';
import { gaveUpReceipt } from './give-up-receipt';

export function TaskGiveUpControl({
  taskId,
  assignmentMode,
  onGaveUp,
}: {
  taskId: number;
  assignmentMode: 'direct' | 'public' | null;
  /**
   * The list the card sits in shows the receipt: the card itself leaves
   * Taskurile mele once the Task is no longer the Member's (Audit D-3).
   */
  onGaveUp?: () => void;
}) {
  const mutation = useGiveUpTask();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const form = useFormValidation(reasonSchema, { reason }, fieldForReason);
  const turn = useReceiptTurn();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;

    setMessage(null);
    try {
      await mutation.mutateAsync({ taskId, reason: values.reason });
      setReason('');
      setOpen(false);
      if (onGaveUp) onGaveUp();
      else {
        setMessage(gaveUpReceipt(assignmentMode));
        turn.claim();
      }
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva renunțarea. Încearcă din nou.');
    }
  }

  if (!open)
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full whitespace-normal"
          onClick={() => {
            form.reset();
            setMessage(null);
            setOpen(true);
          }}
        >
          Renunță la task
        </Button>
        {message && turn.current && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    );

  return (
    <form className="w-full space-y-3" onSubmit={submit} noValidate>
      <div className="space-y-2">
        <label htmlFor={reasonId} className="block text-sm font-medium">
          Motivul renunțării
        </label>
        <textarea
          id={reasonId}
          value={reason}
          disabled={mutation.isPending}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          autoFocus
          className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          {...form.field('reason', `${reasonId}-help`)}
        />
        <FieldError {...form.errorProps('reason')} />
        <p id={`${reasonId}-help`} className="text-sm text-muted-foreground">
          Motivul rămâne în istoricul taskului și este trimis managerului.
        </p>
      </div>
      <FieldError>{form.formError}</FieldError>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="destructive"
          className="min-h-11 min-w-11"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Se salvează…' : 'Confirmă renunțarea'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11"
          disabled={mutation.isPending}
          onClick={() => {
            form.reset();
            setOpen(false);
          }}
        >
          Păstrează taskul
        </Button>
      </div>
    </form>
  );
}
