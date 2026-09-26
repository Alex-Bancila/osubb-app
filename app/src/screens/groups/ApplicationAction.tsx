import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { FieldError } from '../../components/ui/field';
import { CommandError } from '../../lib/command-reasons';
import {
  fieldForReason as noteFields,
  optionalNoteSchema,
} from '../../lib/schemas/note';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useApplicationCommand,
  type ApplicationCommand,
} from '../../queries/group-applications';

export function ApplicationAction({
  label,
  command,
}: {
  label: string;
  command: ApplicationCommand;
}) {
  const mutation = useApplicationCommand();
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // The optional note is checked like every other form (#674, ruling R8).
  const form = useFormValidation(optionalNoteSchema, { note }, noteFields);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (command.kind !== 'withdraw' && !form.validate()) return;
    submitting.current = true;
    setError(null);
    try {
      await mutation.mutateAsync(
        command.kind === 'withdraw' ? command : { ...command, note },
      );
      setOpen(false);
      setNote('');
      setSuccess(true);
    } catch (failure) {
      setError(
        failure instanceof CommandError
          ? failure.message
          : 'Nu am putut salva cererea. Reîncearcă.',
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          setError(null);
          form.reset();
          setSuccess(false);
        }}
      >
        {label}
      </Button>
      {success && (
        <span role="status" className="text-sm text-muted-foreground">
          Cererea a fost actualizată.
        </span>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {command.kind === 'withdraw'
              ? 'Cererea ta nu va mai fi în așteptare.'
              : 'Poți adăuga un mesaj pentru această cerere.'}
          </DialogDescription>
          <form onSubmit={submit} className="grid gap-4">
            {command.kind !== 'withdraw' && (
              <div className="grid gap-2">
                <label className="grid gap-2">
                  Mesaj (opțional)
                  <textarea
                    className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={mutation.isPending}
                    {...form.field('note')}
                  />
                </label>
                <FieldError {...form.errorProps('note')} />
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setOpen(false)}
              >
                Renunță
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Se salvează…' : 'Confirmă'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
