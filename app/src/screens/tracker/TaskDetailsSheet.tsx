import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useAuth } from '../../lib/auth';
import { useTaskDetails } from '../../queries/task-details';
import { useTaskProgress } from '../../queries/task-progress';
import { TaskCard } from './TaskCard';
import { TaskCandidateSelector } from './TaskCandidateSelector';
import { TaskQueueControl } from './TaskQueueControl';
import { TaskHistory } from './TaskHistory';
import { TaskEditControl } from './TaskEditControl';
import { toTaskPresentation } from './task-presentation';

function TaskDetails({
  taskId,
  onNavigate,
  canManage,
}: {
  taskId: number;
  onNavigate: (id: number) => void;
  canManage: boolean;
}) {
  const query = useTaskDetails(taskId);
  const progress = useTaskProgress();
  const memberId = useAuth().session?.user.id;
  if (query.isPending) return <p role="status">Se încarcă taskul…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Nu am putut încărca taskul.</p>
        <Button className="min-h-11 min-w-11" onClick={() => query.refetch()}>
          Reîncarcă taskul
        </Button>
      </div>
    );
  if (!query.data) return <p>Taskul nu este disponibil.</p>;
  const task = toTaskPresentation(query.data.task, new Date());
  const parentId = task.parent?.id;
  const sourceId = task.duplicatedFromTaskId;
  return (
    <div className="space-y-5">
      <TaskCard
        task={task}
        memberId={memberId}
        pending={progress.isPending}
        onProgress={(selectedId, action) =>
          progress.mutateAsync({ taskId: selectedId, action })
        }
      />
      <TaskEditControl task={query.data.task} canManage={canManage} />
      <dl className="grid gap-3 text-sm">
        {task.kind === 'task' && (
          <div>
            <dt className="font-semibold">Dificultate</dt>
            <dd>{task.difficulty ?? 'Neevaluat'}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Audiență</dt>
          <dd>{task.audienceLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold">Atribuire</dt>
          <dd>
            {task.assignmentMode === 'direct'
              ? 'Directă'
              : task.assignmentMode === 'public'
                ? 'Publică'
                : 'Indisponibilă'}
          </dd>
        </div>
        {task.kind === 'task' && (
          <div>
            <dt className="font-semibold">Executor</dt>
            <dd>{query.data.executorName ?? 'Indisponibil'}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Rundă de verificare</dt>
          <dd>{task.reviewRound}</dd>
        </div>
      </dl>
      {parentId !== undefined && (
        <Button
          variant="outline"
          className="min-h-11 min-w-11 whitespace-normal text-foreground"
          onClick={() => onNavigate(parentId)}
        >
          Deschide taskul-umbrelă
        </Button>
      )}
      {sourceId !== null && (
        <p>
          <Button
            variant="link"
            className="min-h-11 min-w-11 whitespace-normal text-foreground"
            onClick={() => onNavigate(sourceId)}
          >
            Duplicat din #{task.duplicatedFromTaskId}
          </Button>
        </p>
      )}
      {task.kind === 'umbrella' && (
        <section aria-label="Subtaskuri">
          <h3 className="font-semibold">Subtaskuri vizibile</h3>
          {query.data.subtasks.length ? (
            <ul>
              {query.data.subtasks.map((child) => (
                <li key={child.id}>
                  <Button
                    variant="link"
                    className="min-h-11 min-w-11 whitespace-normal text-foreground"
                    onClick={() => onNavigate(child.id)}
                  >
                    {child.title}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Niciun subtask vizibil.</p>
          )}
        </section>
      )}
      {canManage && task.kind === 'task' && (
        <section
          aria-labelledby={`task-${taskId}-candidate-heading`}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <div className="space-y-1">
            <h3
              id={`task-${taskId}-candidate-heading`}
              className="font-semibold"
            >
              Coada taskului
            </h3>
            <p className="text-sm text-muted-foreground">
              Poți înlocui executorul numai cu o persoană înscrisă în coadă.
            </p>
          </div>
          {task.assignmentMode === 'public' &&
            !['completed', 'unfulfilled', 'cancelled'].includes(
              task.status,
            ) && <TaskQueueControl taskId={taskId} closed={task.queueClosed} />}
          <TaskCandidateSelector taskId={taskId} />
        </section>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          Istoricul taskului
        </summary>
        <TaskHistory taskId={taskId} />
      </details>
    </div>
  );
}
export function TaskDetailsSheet({
  taskId,
  managedTaskIds = new Set<number>(),
  onClose,
}: {
  taskId: number | null;
  managedTaskIds?: ReadonlySet<number>;
  onClose: () => void;
}) {
  const [relatedId, setRelatedId] = useState<number | null>(null);
  return (
    <Sheet
      open={taskId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRelatedId(null);
          onClose();
        }
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          className="right-0 left-auto w-full max-w-2xl overflow-y-auto p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <SheetTitle className="text-xl font-semibold">
              Detalii task
            </SheetTitle>
            <SheetClose className="min-h-11 min-w-11 rounded-md border border-input px-3 focus-visible:outline-2 focus-visible:outline-ring">
              Închide
            </SheetClose>
          </div>
          {taskId !== null && (
            <TaskDetails
              key={relatedId ?? taskId}
              taskId={relatedId ?? taskId}
              canManage={managedTaskIds.has(relatedId ?? taskId)}
              onNavigate={setRelatedId}
            />
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
