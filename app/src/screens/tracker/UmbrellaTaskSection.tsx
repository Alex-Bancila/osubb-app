import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { FormSheet } from '../../components/ui/form-sheet';
import { commandErrorMessage } from '../../lib/command-reasons';
import {
  useCompleteUmbrella,
  useCreateTasks,
  type CreateTasksInput,
} from '../../queries/task-umbrella';
import type { TaskDetailsData } from '../../queries/task-details';
import { SubHeading } from '../../components/layout';
import { CopiesExecutorsDialog } from './CopiesExecutorsDialog';
import { ManagedTaskForm } from './ManagedTaskForm';
import type { TaskDraft } from './task-form-model';
import {
  isTerminalTask,
  toTaskPresentation,
  type TaskStatus,
} from './task-presentation';

function UmbrellaActions({
  taskId,
  status,
  total,
  terminal,
  onNavigate,
}: {
  taskId: number;
  status: TaskStatus;
  total: number;
  terminal: number;
  onNavigate: (id: number) => void;
}) {
  const create = useCreateTasks();
  const complete = useCompleteUmbrella();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // n Subtasks at once (spec 2026-10-11): the receipt stays on the Umbrella.
  const [added, setAdded] = useState<string | null>(null);
  // A direct draft with several copies waits here for its Executors.
  const [pendingDraft, setPendingDraft] = useState<TaskDraft | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const formAttempt = useRef(0);
  const currentStatus = useRef(status);
  const [attempt, setAttempt] = useState(0);
  // After a Subtask opens, focus belongs to its details, not this button.
  const created = useRef(false);
  function closeForm() {
    if (create.isPending) return;
    formAttempt.current += 1;
    setAdding(false);
  }
  async function finish(input: CreateTasksInput) {
    const tasks = await create.mutateAsync(input);
    if (!mounted.current) return;
    setPendingDraft(null);
    setAdding(false);
    const [first] = tasks;
    if (tasks.length === 1 && first) {
      created.current = true;
      onNavigate(first.id);
    } else {
      setAdded(`${tasks.length} subtaskuri create.`);
    }
  }
  useEffect(() => {
    currentStatus.current = status;
  }, [status]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const explanation =
    total === 0
      ? 'Adaugă cel puțin un subtask înainte de finalizare.'
      : terminal < total
        ? 'Toate subtaskurile trebuie să fie finalizate, neîndeplinite sau anulate.'
        : null;
  return (
    <div className="space-y-3">
      {done && <p role="status">Taskul-umbrelă a fost finalizat.</p>}
      {added && <p role="status">{added}</p>}
      {error && <p role="alert">{error}</p>}
      {!isTerminalTask(status) && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={pending || adding}
              onClick={() => {
                formAttempt.current += 1;
                created.current = false;
                setAttempt(formAttempt.current);
                setAdding(true);
              }}
            >
              Adaugă subtask
            </Button>
            <Button
              className="min-h-11"
              disabled={pending || adding || explanation !== null}
              aria-describedby={
                explanation ? `umbrella-${taskId}-explanation` : undefined
              }
              onClick={async () => {
                if (saving.current) return;
                saving.current = true;
                setPending(true);
                setError(null);
                try {
                  await complete.mutateAsync(taskId);
                  setDone(true);
                } catch (failure) {
                  setError(
                    commandErrorMessage(
                      failure,
                      'Nu am putut finaliza taskul-umbrelă. Reîncearcă.',
                    ),
                  );
                } finally {
                  saving.current = false;
                  setPending(false);
                }
              }}
            >
              {pending ? 'Se finalizează…' : 'Finalizează umbrela'}
            </Button>
          </div>
          {explanation && (
            <p
              id={`umbrella-${taskId}-explanation`}
              className="text-sm text-muted-foreground"
            >
              {explanation}
            </p>
          )}
          <FormSheet
            open={adding}
            onOpenChange={(next) => {
              if (!next) closeForm();
            }}
            title="Subtask nou"
            busy={create.isPending}
            finalFocus={() => !created.current}
            className="sm:max-w-2xl"
          >
            <ManagedTaskForm
              key={attempt}
              parentTaskId={taskId}
              heading={null}
              submitLabel="Creează subtaskul"
              pendingLabel="Se creează subtaskul…"
              plural="subtaskuri"
              onCancel={closeForm}
              onDraft={async (draft) => {
                if (
                  !mounted.current ||
                  attempt !== formAttempt.current ||
                  isTerminalTask(currentStatus.current)
                )
                  return;
                setAdded(null);
                if (draft.assignmentMode === 'direct' && draft.copies > 1) {
                  setStepError(null);
                  setPendingDraft(draft);
                  return;
                }
                const tasks = await create.mutateAsync({ draft });
                if (mounted.current && attempt === formAttempt.current) {
                  setAdding(false);
                  const [first] = tasks;
                  if (tasks.length === 1 && first) {
                    created.current = true;
                    onNavigate(first.id);
                  } else {
                    setAdded(`${tasks.length} subtaskuri create.`);
                  }
                }
              }}
            />
          </FormSheet>
          {pendingDraft && (
            <CopiesExecutorsDialog
              count={pendingDraft.copies}
              originGroupId={pendingDraft.groupId}
              plural="subtaskuri"
              busy={create.isPending}
              error={stepError}
              onBack={() => setPendingDraft(null)}
              onConfirm={async (executorIds) => {
                setStepError(null);
                try {
                  await finish({ draft: pendingDraft, executorIds });
                } catch (failure) {
                  setStepError(
                    commandErrorMessage(
                      failure,
                      'Nu am putut crea subtaskurile. Încearcă din nou.',
                    ),
                  );
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

export function UmbrellaTaskSection({
  taskId,
  status,
  subtasks,
  canManage,
  onNavigate,
}: {
  taskId: number;
  status: TaskStatus;
  subtasks: TaskDetailsData['subtasks'];
  canManage: boolean;
  onNavigate: (id: number) => void;
}) {
  const terminal = subtasks.filter((task) =>
    isTerminalTask(task.status),
  ).length;
  return (
    <section aria-label="Subtaskuri" className="flex flex-col gap-3">
      {/* The count is on the Umbrella's card ("x din y subtaskuri"). */}
      <SubHeading variant="label">Subtaskuri vizibile</SubHeading>
      {subtasks.length ? (
        <ul className="space-y-3">
          {subtasks.map((row) => {
            const child = toTaskPresentation(row, new Date());
            return (
              <li
                key={child.id}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <Button
                  variant="link"
                  className="min-h-11 max-w-full whitespace-normal text-left text-foreground"
                  onClick={() => onNavigate(child.id)}
                >
                  {child.title}
                </Button>
                <div>
                  <Badge variant="outline">{child.statusLabel}</Badge>
                </div>
                {/* A finished Subtask names only the Member who finished it,
                    as the RPC returns them (Audit D-1, #861); a cancelled
                    one names nobody and never reads "Neatribuit". */}
                {(!isTerminalTask(child.status) || row.visibleExecutor) && (
                  <p className="text-sm">
                    Executor:{' '}
                    {row.visibleExecutor?.fullName ??
                      (row.visibleExecutor
                        ? 'Nume indisponibil'
                        : 'Neatribuit sau indisponibil')}
                  </p>
                )}
                <p className="text-sm">Termen: {child.deadlineLabel}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Niciun subtask vizibil.</p>
      )}
      {canManage && (
        <UmbrellaActions
          taskId={taskId}
          status={status}
          total={subtasks.length}
          terminal={terminal}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}
