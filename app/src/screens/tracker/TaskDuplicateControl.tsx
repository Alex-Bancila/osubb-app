import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DateTimePicker } from '../../components/ui/date-picker';
import { FieldError } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { fieldForReason, taskDuplicateSchema } from '../../lib/schemas/task';
import { useFormValidation } from '../../lib/use-form-validation';
import { useDuplicateTask } from '../../queries/task-duplication';

/**
 * "Duplică" asks for one thing, the new deadline, in a form sheet; what the
 * copy keeps is behind the field's "i". Its button is the copy icon alone,
 * named "Duplică".
 */
export function TaskDuplicateControl({
  taskId,
  onDuplicated,
}: {
  taskId: number;
  onDuplicated: (id: number) => void;
}) {
  const id = useId();
  const mutation = useDuplicateTask();
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState('');
  const schema = useMemo(() => taskDuplicateSchema(), []);
  const form = useFormValidation(schema, { deadline }, fieldForReason);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  // After a copy opens, focus belongs to the details heading, not this button.
  const duplicated = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const values = form.validate();
    if (!values) return;
    submitting.current = true;
    setPending(true);
    try {
      const clone = await mutation.mutateAsync({
        taskId,
        deadline: values.deadline,
      });
      duplicated.current = true;
      setOpen(false);
      onDuplicated(clone.id);
    } catch (failure) {
      form.fail(failure, 'Nu am putut duplica taskul. Încearcă din nou.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  function close() {
    if (pending) return;
    setOpen(false);
    form.reset();
  }
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        title="Duplică"
        onClick={() => setOpen(true)}
      >
        <Copy aria-hidden="true" />
        <span className="sr-only">Duplică</span>
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
        }}
        title="Duplică taskul"
        busy={pending}
        finalFocus={() => !duplicated.current}
      >
        <form
          className="flex flex-1 flex-col gap-5"
          aria-label="Duplică taskul"
          noValidate
          onSubmit={submit}
        >
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
                Termen nou — ora României
              </label>
              <InfoHint label="Despre copie" id={`${id}-info`}>
                Copia are un termen nou și păstrează legătura cu acest task.
                Executorul și rezultatele nu se copiază.
              </InfoHint>
            </div>
            <DateTimePicker
              id={`${id}-deadline`}
              required
              defaultTime="23:59"
              value={deadline}
              onChange={setDeadline}
              disabled={pending}
              {...form.field('deadline', `${id}-info`)}
            />
            <FieldError {...form.errorProps('deadline')} />
          </div>
          <FieldError>{form.formError}</FieldError>
          {pending && <p role="status">Se duplică taskul…</p>}
          <FormSheetFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              Renunță
            </Button>
            <Button type="submit" disabled={pending}>
              Creează copia
            </Button>
          </FormSheetFooter>
        </form>
      </FormSheet>
    </>
  );
}
