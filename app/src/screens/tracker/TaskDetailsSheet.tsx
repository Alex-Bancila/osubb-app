import { TaskAssignControl } from './TaskAssignControl';
import { TaskCancelControl } from './TaskCancelControl';
import { TaskReopenControl } from './TaskReopenControl';
import { TaskFeedbackControl } from './TaskFeedbackControl';
import { TaskReviewCapabilityNotice } from './TaskReviewCapabilityNotice';
import { useRef, useState } from 'react';
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
import { TaskDuplicateControl } from './TaskDuplicateControl';
import { TaskActionSuccess } from './TaskActionSuccess';
import { TaskCard } from './TaskCard';
import { TaskCandidateSelector } from './TaskCandidateSelector';
import { UmbrellaTaskSection } from './UmbrellaTaskSection';
import { TaskQueueControl } from './TaskQueueControl';
import { TaskHistory } from './TaskHistory';
import { TaskEditControl } from './TaskEditControl';
import { TaskEvaluationControl } from './TaskEvaluationControl';
import { isTerminalTask, toTaskPresentation } from './task-presentation';

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
      <div className="[&>article]:h-auto [&_[data-slot=card]]:h-auto">
        <TaskCard
          task={task}
          memberId={memberId}
          pending={progress.isPending}
          onProgress={(selectedId, action) =>
            progress.mutateAsync({ taskId: selectedId, action })
          }
        />
      </div>
      {canManage && task.kind === 'task' && (
        <TaskDuplicateControl taskId={taskId} onDuplicated={onNavigate} />
      )}
      <TaskEditControl task={query.data.task} canManage={canManage} />
      <TaskAssignControl
        taskId={taskId}
        groupId={query.data.task.group_id}
        status={task.status}
        kind={task.kind}
        assignmentMode={task.assignmentMode}
        hasExecutor={task.executor !== null}
        canManage={canManage}
      />
      <TaskCancelControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
        canManage={canManage}
      />
      <TaskReopenControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
      />
      <TaskFeedbackControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
      />
      {task.kind === 'task' && <TaskReviewCapabilityNotice taskId={taskId} />}
      <TaskEvaluationControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
        overdue={task.overdue}
        hasExecutor={task.executor !== null}
        executorName={query.data.executorName}
      />
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
        <UmbrellaTaskSection
          taskId={taskId}
          status={task.status}
          subtasks={query.data.subtasks}
          canManage={canManage}
          onNavigate={onNavigate}
        />
      )}
      {canManage && task.kind === 'task' && !isTerminalTask(task.status) && (
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
          {task.assignmentMode === 'public' && (
            <TaskQueueControl taskId={taskId} closed={task.queueClosed} />
          )}
          {/* private.select_task_candidate_impl refuses in_review with
              PT409 task_in_review — a Task returned/evaluated mid-review is
              never handed to someone else, so the selector has nothing to
              offer here (#646). */}
          {task.status !== 'in_review' && (
            <TaskCandidateSelector taskId={taskId} />
          )}
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
  notice = null,
  onClose,
}: {
  taskId: number | null;
  managedTaskIds?: ReadonlySet<number>;
  /** A confirmation for the opened Task, e.g. after it was just created. */
  notice?: string | null;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
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
            <SheetTitle
              ref={titleRef}
              tabIndex={-1}
              className="text-xl font-semibold"
            >
              Detalii task
            </SheetTitle>
            <SheetClose className="min-h-11 min-w-11 rounded-md border border-input px-3 focus-visible:outline-2 focus-visible:outline-ring">
              Închide
            </SheetClose>
          </div>
          {taskId !== null && notice && relatedId === null && (
            <div className="mb-5">
              <TaskActionSuccess>{notice}</TaskActionSuccess>
            </div>
          )}
          {taskId !== null && (
            <TaskDetails
              key={relatedId ?? taskId}
              taskId={relatedId ?? taskId}
              canManage={managedTaskIds.has(relatedId ?? taskId)}
              onNavigate={(id) => {
                setRelatedId(id);
                titleRef.current?.focus();
              }}
            />
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
