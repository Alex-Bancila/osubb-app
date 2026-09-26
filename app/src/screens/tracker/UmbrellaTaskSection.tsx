import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { commandErrorMessage } from '../../lib/command-reasons';
import {
  useCompleteUmbrella,
  useCreateTask,
} from '../../queries/task-umbrella';
import type { TaskDetailsData } from '../../queries/task-details';
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
            <div className="space-y-3 rounded-lg border border-border p-4">
              <h4 className="font-semibold">Subtask nou</h4>
              <ManagedTaskForm
                parentTaskId={taskId}
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
              <Button
                variant="outline"
                className="min-h-11"
                disabled={create.isPending}
                onClick={() => {
                  formAttempt.current += 1;
                  setAdding(false);
                }}
              >
                Închide formularul
              </Button>
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
    <section aria-label="Subtaskuri" className="space-y-3">
      <h3 className="font-semibold">Subtaskuri vizibile</h3>
      <p>
        {terminal} / {subtasks.length} finalizate
      </p>
      {subtasks.length ? (
        <ul className="space-y-3">
          {subtasks.map((row) => {
            const child = toTaskPresentation(row, new Date());
            return (
              <li
                key={child.id}
                className="space-y-2 rounded-lg border border-border p-3"
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
                <p className="text-sm">
                  Executor:{' '}
                  {row.visibleExecutor?.fullName ??
                    'Neatribuit sau indisponibil'}
                </p>
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
