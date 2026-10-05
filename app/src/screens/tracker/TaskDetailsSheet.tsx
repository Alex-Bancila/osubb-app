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
import {
  formatBucharestDay,
  formatBucharestTime,
} from '../../lib/calendar-time';
import { useTaskHistory } from '../../queries/task-history';
import { cn } from '../../lib/utils';
import {
  NO_SUBJECTS,
  useReadNotificationsAbout,
} from '../../queries/notifications';
import { useTaskDetails } from '../../queries/task-details';
import { useTaskProgress } from '../../queries/task-progress';
import { TaskDuplicateControl } from './TaskDuplicateControl';
import { TaskActionSuccess } from './TaskActionSuccess';
import { useReceiptTurn } from './receipt-turn';
import { ReceiptTurnScope } from './ReceiptTurnScope';
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

/**
 * The reviewer's note on the latest return to progress, for the Executor who
 * has to act on it (F-23): read from the history the Executor may read, so
 * they need not open "Istoricul taskului" to learn what to change.
 */
function ReturnNote({ taskId }: { taskId: number }) {
  const history = useTaskHistory(taskId);
  // A failed read must not look like "no note": say so and offer a retry.
  if (history.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Nu am putut încărca modificările cerute.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void history.refetch()}
        >
          Reîncarcă modificările cerute
        </Button>
      </div>
    );
  const latest = history.data
    ?.filter((row) => row.kind === 'returned_to_progress')
    .at(-1);
  const note = latest?.note?.trim();
  if (!latest || !note) return null;
  return (
    <section
      aria-label="Modificări cerute"
      data-slot="return-note"
      className="min-w-0 space-y-2 rounded-lg border-l-2 border-primary/70 bg-muted/60 px-3 py-2.5"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Modificări cerute
        <time
          dateTime={latest.occurred_at}
          className="font-normal tracking-normal normal-case"
        >
          {formatBucharestDay(latest.occurred_at)},{' '}
          {formatBucharestTime(latest.occurred_at)}
        </time>
      </p>
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{note}</p>
    </section>
  );
}

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
  // #1012 (R37): opening a Task reads the member's Notifications about it.
  useReadNotificationsAbout(query.data ? [`task:${taskId}`] : NO_SUBJECTS);
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
  const ownReturnedTask =
    task.feedbackPending &&
    memberId !== undefined &&
    task.executor?.memberId === memberId &&
    task.executor.isCurrent;
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
      {ownReturnedTask && <ReturnNote taskId={taskId} />}
      {task.submission && (
        <SubmissionNote submission={task.submission} showTime />
      )}
      <dl
        data-slot="task-facts"
        className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm empty:hidden"
      >
        {/* An Umbrella has no Assignment (F-28): no Atribuire fact. */}
        {task.assignmentMode !== null && task.kind === 'task' && (
          <div className="min-w-0">
            <dt className="font-semibold">Atribuire</dt>
            <dd>{task.assignmentMode === 'direct' ? 'Directă' : 'Publică'}</dd>
          </div>
        )}
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
        {/* "Has an Executor" means one who holds the Task now; the Member who
            finished it (#861) is named on the card, not assignable again. */}
        <TaskAssignControl
          taskId={taskId}
          groupId={query.data.task.group_id}
          status={task.status}
          kind={task.kind}
          assignmentMode={task.assignmentMode}
          hasExecutor={task.executor?.isCurrent === true}
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
          hasExecutor={task.executor?.isCurrent === true}
          executorName={query.data.executorName}
          groupId={query.data.task.group_id}
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
      {/* Only a public Task has a Candidate Queue: a direct one has no queue
          section at all, in any status (F-2, Alex 2026-09-29). */}
      {canManage &&
        task.kind === 'task' &&
        task.assignmentMode === 'public' &&
        !isTerminalTask(task.status) && (
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
            <TaskQueueControl taskId={taskId} closed={task.queueClosed} />
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

/** The opener's notice ("Taskul a fost creat.") until a command answers. */
function SheetNotice({ children }: { children: string }) {
  const turn = useReceiptTurn();
  return turn.current ? (
    <TaskActionSuccess>{children}</TaskActionSuccess>
  ) : null;
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
          {/* One receipt at a time: the latest command's (Audit D-16). */}
          <ReceiptTurnScope key={shownId ?? 'none'}>
            {current && notice && current.visited.length === 0 && (
              <SheetNotice>{notice}</SheetNotice>
            )}
            {current && shownId !== null && (
              <TaskDetails
                taskId={shownId}
                canManage={managedTaskIds.has(shownId)}
                onNavigate={(id) => go(sheetTrailPush(current, id))}
              />
            )}
          </ReceiptTurnScope>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
