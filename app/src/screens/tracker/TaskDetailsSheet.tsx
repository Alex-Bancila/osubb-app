import { TaskAssignControl } from './TaskAssignControl';
import { TaskCancelControl } from './TaskCancelControl';
import { TaskReopenControl } from './TaskReopenControl';
import { TaskFeedbackControl } from './TaskFeedbackControl';
import { TaskReviewCapabilityNotice } from './TaskReviewCapabilityNotice';
import { useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { focusRingClass, SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetBackdrop,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { useTaskDetails } from '../../queries/task-details';
import { useTaskProgress } from '../../queries/task-progress';
import { TaskDuplicateControl } from './TaskDuplicateControl';
import { TaskActionSuccess } from './TaskActionSuccess';
import { TaskCard } from './TaskCard';
import { SubmissionNote } from './SubmissionNote';
import { TaskCandidateSelector } from './TaskCandidateSelector';
import { UmbrellaTaskSection } from './UmbrellaTaskSection';
import { TaskQueueControl } from './TaskQueueControl';
import { TaskHistory } from './TaskHistory';
import { TaskEditControl } from './TaskEditControl';
import { TaskEvaluationControl } from './TaskEvaluationControl';
import { isTerminalTask, toTaskPresentation } from './task-presentation';
import {
  sheetTrailBack,
  sheetTrailCurrent,
  sheetTrailPrevious,
  sheetTrailPush,
  type SheetTrail,
} from './sheet-trail';

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
  // Rundă de verificare says something only once a review returned the work,
  // and only to whoever reviews it (relevance B20).
  const showReviewRound = canManage && task.reviewRound >= 1;
  return (
    <div className="flex flex-col gap-5">
      <div className="[&>article]:h-auto [&_[data-slot=card]]:h-auto">
        {/* The card says the Group, status, deadline, Executor, stage and
            Evaluation; the list below adds only what it does not. */}
        <TaskCard
          task={task}
          memberId={memberId}
          pending={progress.isPending}
          onProgress={(input) => progress.mutateAsync(input)}
          anchor={false}
          showSubmissionNote={false}
          inSheet
        />
      </div>
      {task.submission && (
        <SubmissionNote submission={task.submission} showTime />
      )}
      <dl
        data-slot="task-facts"
        className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"
      >
        <div className="min-w-0">
          <dt className="font-semibold">Atribuire</dt>
          <dd>
            {task.assignmentMode === 'direct'
              ? 'Directă'
              : task.assignmentMode === 'public'
                ? 'Publică'
                : 'Indisponibilă'}
          </dd>
        </div>
        {/* A direct Task is local only (R26): its Audience says nothing. */}
        {task.assignmentMode === 'public' && (
          <div className="min-w-0">
            <dt className="font-semibold">Audiență</dt>
            <dd>{task.audienceLabel}</dd>
          </div>
        )}
        {showReviewRound && (
          <div className="min-w-0">
            <dt className="font-semibold">Rundă de verificare</dt>
            <dd className="tabular-nums">{task.reviewRound}</dd>
          </div>
        )}
      </dl>
      {(parentId !== undefined || sourceId !== null) && (
        <div className="flex flex-wrap gap-2">
          {parentId !== undefined && (
            <Button
              variant="outline"
              className="whitespace-normal"
              onClick={() => onNavigate(parentId)}
            >
              Deschide taskul-umbrelă
            </Button>
          )}
          {sourceId !== null && (
            <Button
              variant="outline"
              className="whitespace-normal"
              onClick={() => onNavigate(sourceId)}
            >
              Duplicat din #{task.duplicatedFromTaskId}
            </Button>
          )}
        </div>
      )}
      {/* The commands in one wrapping row (layout T5). A control that opens
          an inline form or leaves a receipt takes the full row. */}
      <div
        data-slot="task-actions"
        className="flex flex-wrap items-start gap-2 empty:hidden [&>*:has(form)]:basis-full [&>*:has([role=status])]:basis-full [&>[role=status]]:basis-full"
      >
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
        <TaskEvaluationControl
          taskId={taskId}
          status={task.status}
          kind={task.kind}
          overdue={task.overdue}
          hasExecutor={task.executor !== null}
          executorName={query.data.executorName}
        />
      </div>
      {task.kind === 'task' && <TaskReviewCapabilityNotice taskId={taskId} />}
      {task.kind === 'umbrella' && (
        <UmbrellaTaskSection
          taskId={taskId}
          status={task.status}
          subtasks={query.data.subtasks}
          canManage={canManage}
          onNavigate={onNavigate}
        />
      )}
      {canManage &&
        task.kind === 'task' &&
        !isTerminalTask(task.status) &&
        // In review there is no Candidate to select; a direct Task has no queue
        // toggle either, so the section would be empty.
        !(task.status === 'in_review' && task.assignmentMode !== 'public') && (
          <section
            aria-labelledby={`task-${taskId}-candidate-heading`}
            className="flex flex-col gap-3 rounded-md border border-border p-4"
          >
            <div className="flex flex-col gap-1">
              <SubHeading
                id={`task-${taskId}-candidate-heading`}
                variant="label"
              >
                Coada taskului
              </SubHeading>
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
        <summary
          className={cn(
            'min-h-11 cursor-pointer rounded-sm py-3 font-semibold',
            focusRingClass,
          )}
        >
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
  const [trail, setTrail] = useState<SheetTrail | null>(null);
  // A new Task opened from the list starts a new trail.
  const current =
    taskId === null
      ? null
      : trail && trail.opened === taskId
        ? trail
        : { opened: taskId, visited: [] };
  const shownId = current ? sheetTrailCurrent(current) : null;
  const previousId = current ? sheetTrailPrevious(current) : null;
  function go(next: SheetTrail) {
    setTrail(next);
    titleRef.current?.focus();
  }
  return (
    <Sheet
      open={taskId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTrail(null);
          onClose();
        }
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          side="right"
          className="max-w-2xl gap-5 p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle ref={titleRef} tabIndex={-1} className="outline-none">
              Detalii task
            </SheetTitle>
          </SheetHeader>
          {current && previousId !== null && (
            <button
              type="button"
              data-slot="sheet-back"
              onClick={() => go(sheetTrailBack(current))}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
                focusRingClass,
              )}
            >
              <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
              Înapoi la #{previousId}
            </button>
          )}
          {current && notice && current.visited.length === 0 && (
            <TaskActionSuccess>{notice}</TaskActionSuccess>
          )}
          {current && shownId !== null && (
            <TaskDetails
              key={shownId}
              taskId={shownId}
              canManage={managedTaskIds.has(shownId)}
              onNavigate={(id) => go(sheetTrailPush(current, id))}
            />
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
