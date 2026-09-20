import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  TaskModeError,
  useConvertTaskMode,
  useTaskParticipation,
  type TaskAssignmentMode,
  type TaskAudience,
} from '../../queries/task-mode';
import { isTerminalTask, type TaskPresentationRow } from './task-presentation';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';

/**
 * ADR-0007 §Task identity: a Task's Audience and Assignment Mode are mutable
 * only before its first Assignment or Candidature, so this control exists
 * exactly in that window and disappears for good once either happens.
 *
 * Authority is not inferred here. `canManage` is the same live, server-derived
 * capability the neighbouring manager controls render from; the shape rules
 * below (Umbrella, terminal, participation) only keep the browser from
 * offering a conversion the command would certainly refuse. The command
 * itself remains the decision — every refusal is translated and refetched.
 */
export function TaskModeControl({
  task,
  canManage,
}: {
  task: TaskPresentationRow;
  canManage: boolean;
}) {
  const convertible =
    canManage && task.kind !== 'umbrella' && !isTerminalTask(task.status);
  const participation = useTaskParticipation(task.id, convertible);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const receipt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (saved) receipt.current?.focus();
  }, [saved]);
  const untouched =
    participation.data?.assigned === false &&
    participation.data.hasCandidates === false;
  return (
    <section aria-label="Modul de atribuire al taskului" className="space-y-3">
      {saved && (
        <p ref={receipt} role="status" tabIndex={-1}>
          Modul de atribuire a fost schimbat și înregistrat în istoricul
          taskului.
        </p>
      )}
      {convertible &&
        untouched &&
        (open ? (
          <TaskModeForm
            task={task}
            onCancel={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              setSaved(true);
            }}
          />
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              setSaved(false);
            }}
          >
            Schimbă modul
          </Button>
        ))}
    </section>
  );
}

function TaskModeForm({
  task,
  onCancel,
  onSaved,
}: {
  task: TaskPresentationRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const mutation = useConvertTaskMode();
  const [assignmentMode, setAssignmentMode] = useState<TaskAssignmentMode>(
    task.assignment_mode === 'public' ? 'public' : 'direct',
  );
  // A direct Task keeps the Audience it already has: the command takes both
  // fields on every call, and only a public Task's queue is audience-bound.
  const [audience, setAudience] = useState<TaskAudience>(
    task.audience === 'org' ? 'org' : 'local',
  );
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    submitting.current = true;
    try {
      await mutation.mutateAsync({ taskId: task.id, assignmentMode, audience });
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof TaskModeError
          ? failure.message
          : 'Nu am putut schimba modul taskului. Reîncearcă.',
      );
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border p-4"
      aria-label="Schimbă modul de atribuire"
    >
      <p className="text-sm">
        Modul de atribuire și audiența se pot schimba doar până când taskul are
        un executor sau un candidat.
      </p>
      <fieldset disabled={mutation.isPending} className="space-y-3">
        <legend className="sr-only">Modul de atribuire</legend>
        <div>
          <label htmlFor={`${id}-mode`} className="text-sm font-medium">
            Mod de atribuire
          </label>
          <select
            id={`${id}-mode`}
            className={control}
            value={assignmentMode}
            onChange={(event) =>
              setAssignmentMode(
                event.target.value === 'public' ? 'public' : 'direct',
              )
            }
          >
            <option value="direct">Direct</option>
            <option value="public">Public</option>
          </select>
        </div>
        {assignmentMode === 'public' && (
          <div>
            <label htmlFor={`${id}-audience`} className="text-sm font-medium">
              Audiență
            </label>
            <select
              id={`${id}-audience`}
              className={control}
              value={audience}
              onChange={(event) =>
                setAudience(event.target.value === 'org' ? 'org' : 'local')
              }
            >
              <option value="local">Doar grupul</option>
              <option value="org">Toată organizația</option>
            </select>
            <p className="text-sm text-muted-foreground">
              Audiența decide cine se poate înscrie în coada taskului.
            </p>
          </div>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          Salvează modul
        </Button>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Înapoi
        </Button>
      </div>
    </form>
  );
}
