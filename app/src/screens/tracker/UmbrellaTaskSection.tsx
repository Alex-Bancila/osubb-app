import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { commandErrorMessage } from '../../lib/command-reasons';
import {
  useCompleteUmbrella,
  useCreateTask,
} from '../../queries/task-umbrella';
import type { TaskDetailsData } from '../../queries/task-details';
import { SubHeading } from '../../components/layout';
import { ManagedTaskForm } from './ManagedTaskForm';
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
  const create = useCreateTask();
  const complete = useCompleteUmbrella();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  const formAttempt = useRef(0);
  const currentStatus = useRef(status);
  const [attempt, setAttempt] = useState(0);
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
          {adding && (
            <div className="flex flex-col gap-3 rounded-md border border-border p-4">
              <SubHeading as="h4" variant="label">
                Subtask nou
              </SubHeading>
              <ManagedTaskForm
                parentTaskId={taskId}
                heading={null}
                cancelLabel="Închide formularul"
                onCancel={() => {
                  if (create.isPending) return;
                  formAttempt.current += 1;
                  setAdding(false);
                }}
                onDraft={async (draft) => {
                  if (
                    !mounted.current ||
                    attempt !== formAttempt.current ||
                    isTerminalTask(currentStatus.current)
                  )
                    return;
                  const task = await create.mutateAsync(draft);
                  if (mounted.current && attempt === formAttempt.current)
                    onNavigate(task.id);
                }}
              />
            </div>
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
                {/* A finished Subtask's Assignment has ended: the RPC no
                    longer names its Executor (Audit D-1, #861). */}
                {!isTerminalTask(child.status) && (
                  <p className="text-sm">
                    Executor:{' '}
                    {row.visibleExecutor?.fullName ??
                      'Neatribuit sau indisponibil'}
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
