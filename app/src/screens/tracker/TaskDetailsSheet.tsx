import { TaskAssignControl } from './TaskAssignControl';
import { TaskCancelControl } from './TaskCancelControl';
import { TaskDeleteControl } from './TaskDeleteControl';
import { TaskReopenControl } from './TaskReopenControl';
import { TaskFeedbackControl } from './TaskFeedbackControl';
import { TaskReviewCapabilityNotice } from './TaskReviewCapabilityNotice';
import {
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  Award,
  Ban,
  CircleX,
  Clock,
  CornerLeftUp,
  Files,
  Flag,
  History,
  Layers,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { FormattedText } from '../../components/formatted-text/FormattedText';
import { focusRingClass, SubHeading } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { Disclosure } from '../../components/ui/disclosure';
import { ActionMenu } from '../../components/ui/menu';
import {
  Sheet,
  SheetBackdrop,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useAuth } from '../../lib/auth';
import { formatBucharestShort } from '../../lib/calendar-time';
import { useTaskHistory } from '../../queries/task-history';
import { cn } from '../../lib/utils';
import {
  NO_SUBJECTS,
  useReadNotificationsAbout,
} from '../../queries/notifications';
import { useTaskDetails } from '../../queries/task-details';
import { useTaskManageCapability } from '../../queries/task-lists';
import { useTaskProgress } from '../../queries/task-progress';
import { TaskDuplicateControl } from './TaskDuplicateControl';
import { TaskActionSuccess } from './TaskActionSuccess';
import { useReceiptTurn } from './receipt-turn';
import { ReceiptTurnScope } from './ReceiptTurnScope';
import {
  TaskEvaluationLine,
  TaskGroupChip,
  TaskStatusBadges,
} from './TaskParts';
import { TaskExecutorActions } from './TaskExecutorActions';
import { TaskStageSummary } from './TaskStageSummary';
import { TaskQueueStatus } from './TaskQueueStatus';
import { showsExecutorLine } from './task-executor-line';
import { SubmissionNote } from './SubmissionNote';
import { TaskCandidateSelector } from './TaskCandidateSelector';
import { UmbrellaTaskSection } from './UmbrellaTaskSection';
import { TaskQueueControl } from './TaskQueueControl';
import { TaskHistory } from './TaskHistory';
import { TaskEditControl } from './TaskEditControl';
import {
  TaskEvaluationControl,
  type TaskEvaluationActions,
} from './TaskEvaluationControl';
import { canCancelTask, useCanMarkUnfulfilled } from './task-menu-actions';
import {
  isTerminalTask,
  toTaskPresentation,
  type TaskPresentation,
} from './task-presentation';
import type { MenuDialog } from './menu-dialog';
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
          {formatBucharestShort(latest.occurred_at)}
        </time>
      </p>
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{note}</p>
    </section>
  );
}

/** The sheet's name until the Task has loaded, and when it cannot be shown. */
const SHEET_TITLE = 'Detalii task';

/**
 * The sheet is titled by the Task it shows. Its own small reader of the
 * details query, so the title element stays the same one across a step to
 * another Task and can keep the focus it was given.
 */
function SheetTaskTitle({ taskId }: { taskId: number }) {
  const query = useTaskDetails(taskId);
  return query.data?.task.title.trim() || SHEET_TITLE;
}

/** Under the title: the Task's Group and where it stands. */
function SheetTaskChips({ taskId }: { taskId: number }) {
  const query = useTaskDetails(taskId);
  if (!query.data) return null;
  const task = toTaskPresentation(query.data.task, new Date());
  return (
    <div
      data-slot="task-sheet-chips"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      style={
        {
          '--task-stripe': task.origin.color ?? 'var(--ink-400)',
        } as CSSProperties
      }
    >
      <TaskGroupChip task={task} />
      <TaskStatusBadges task={task} />
    </div>
  );
}

/** One fact about the Task: its icon and label, then the value. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-x-3 py-2">
      <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground max-sm:w-28">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="m-0 min-w-0 flex-1 font-medium wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

/**
 * The Task's facts as plain label/value rows — no card inside the sheet. A
 * row is shown only when it says something true that concerns the reader.
 */
function TaskFacts({
  task,
  memberId,
  showReviewRound,
}: {
  task: TaskPresentation;
  memberId: string | undefined;
  showReviewRound: boolean;
}) {
  return (
    <dl
      data-slot="task-facts"
      className="m-0 divide-y divide-(--border-soft) border-y border-(--border-soft) text-sm"
    >
      <Fact icon={Clock} label="Termen">
        {task.deadline ? (
          <time
            dateTime={task.deadline}
            className={task.overdue ? 'font-semibold text-destructive' : ''}
          >
            {formatBucharestShort(task.deadline)}
          </time>
        ) : (
          task.deadlineLabel
        )}
      </Fact>
      {showsExecutorLine(task, memberId) && (
        <Fact icon={UserRound} label="Executor">
          {/* Only an identity #499's lookup returned becomes a name button;
              an Executor known by id alone stays anonymous. */}
          {task.executor?.name ? (
            <MemberName
              size="sm"
              memberId={task.executor.memberId}
              nickname={task.executor.nickname}
              fullName={task.executor.name}
            />
          ) : task.executor ? (
            'Nume indisponibil'
          ) : (
            'Neatribuit'
          )}
        </Fact>
      )}
      {task.campaign && (
        <Fact icon={Flag} label="Campanie">
          {task.campaign.name}
        </Fact>
      )}
      {task.parent && (
        <Fact icon={Layers} label="Subtask din">
          {task.parent.title}
        </Fact>
      )}
      {/* An Umbrella has no Assignment (F-28): no Atribuire fact. */}
      {task.assignmentMode !== null && task.kind === 'task' && (
        <Fact icon={UserCheck} label="Atribuire">
          {task.assignmentMode === 'direct' ? 'Directă' : 'Publică'}
        </Fact>
      )}
      {/* A direct Task is local only (R26): its Audience says nothing. */}
      {task.assignmentMode === 'public' && (
        <Fact icon={Users} label="Audiență">
          {task.audienceLabel}
        </Fact>
      )}
      {/* R57: the Role a public Task asks for, when above Recrut. */}
      {task.assignmentMode === 'public' && task.minLevelLabel && (
        <Fact icon={ShieldCheck} label="Cine îl vede">
          {task.minLevelLabel}
        </Fact>
      )}
      {showReviewRound && (
        <Fact icon={RefreshCw} label="Rundă de verificare">
          <span className="tabular-nums">{task.reviewRound}</span>
        </Fact>
      )}
      {task.points !== null && (
        <Fact icon={Award} label="Evaluare">
          <TaskEvaluationLine task={task} />
        </Fact>
      )}
    </dl>
  );
}

/** Which of the menu's pop-ups is open. */
type MenuAction = 'cancel' | 'delete';

function TaskDetails({
  taskId,
  onNavigate,
  canManage,
  onDeleted,
}: {
  taskId: number;
  onNavigate: (id: number) => void;
  canManage: boolean;
  onDeleted: (receipt: string) => void;
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
  // The viewer holds this Task: no queue news for them (relevance B14).
  const ownTask =
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId;
  const ownReturnedTask =
    task.feedbackPending && ownTask && task.executor?.isCurrent === true;
  return (
    <div className="flex flex-col gap-5">
      {task.description && (
        // Formatted Text (R60); the Submission Note and the return note below
        // stay plain.
        <div data-slot="task-description" className="text-sm">
          <FormattedText view="full" text={task.description} />
        </div>
      )}
      {(task.assignmentMode !== 'public' || ownTask) && (
        <TaskStageSummary task={task} />
      )}
      {/* Queue lines are for a Candidate: never for the Executor (B14),
          never on a finished Task, where they are history (Audit D-1). */}
      {task.assignmentMode === 'public' &&
        !ownTask &&
        !isTerminalTask(task.status) && (
          <TaskQueueStatus taskId={task.id} task={task} />
        )}
      {ownReturnedTask && <ReturnNote taskId={taskId} />}
      {task.submission && (
        <SubmissionNote submission={task.submission} showTime />
      )}
      <TaskFacts
        task={task}
        memberId={memberId}
        showReviewRound={showReviewRound}
      />
      {/* R46: "Deschide: <etichetă>" in a details view. */}
      <AttachedLinksList
        links={task.links}
        variant="details"
        buttonClassName="max-w-full text-left wrap-anywhere"
      />
      {/* The Executor's own steps: Începe, Trimite la verificare, Renunță. */}
      <TaskExecutorActions
        task={task}
        memberId={memberId}
        pending={progress.isPending}
        onProgress={(input) => progress.mutateAsync(input)}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        messagesClassName="space-y-2"
      />
      {(parentId !== undefined || sourceId !== null) && (
        <div className="flex flex-wrap gap-2">
          {parentId !== undefined && (
            <Button
              variant="outline"
              className="whitespace-normal"
              onClick={() => onNavigate(parentId)}
            >
              <CornerLeftUp aria-hidden="true" />
              Deschide taskul-umbrelă
            </Button>
          )}
          {sourceId !== null && (
            <Button
              variant="outline"
              className="whitespace-normal"
              onClick={() => onNavigate(sourceId)}
            >
              <Files aria-hidden="true" />
              Duplicat din #{task.duplicatedFromTaskId}
            </Button>
          )}
        </div>
      )}
      <TaskActions
        task={task}
        row={query.data.task}
        executorName={query.data.executorName}
        canManage={canManage}
        onNavigate={onNavigate}
        onDeleted={onDeleted}
      />
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
      <Disclosure
        className="border-t border-(--border-soft)"
        summary={
          <>
            <History
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            Istoricul taskului
          </>
        }
      >
        <TaskHistory taskId={taskId} />
      </Disclosure>
    </div>
  );
}

/**
 * The commands on the Task, in one row with a hierarchy: the step the Task
 * waits for as a filled button (Editează, or Evaluează once it is in
 * review), the other steps outlined beside it, Duplică as an icon button,
 * and the rest — Anulează taskul, Marchează nerealizat and, last, Șterge
 * definitiv — behind one "⋯" menu. Each control keeps its own rule for who
 * sees it, its own pop-up and its own receipt; a control that opens an
 * inline form or leaves a receipt takes the full row.
 */
function TaskActions({
  task,
  row,
  executorName,
  canManage,
  onNavigate,
  onDeleted,
}: {
  task: TaskPresentation;
  row: Parameters<typeof TaskEditControl>[0]['task'];
  executorName: string | null;
  canManage: boolean;
  onNavigate: (id: number) => void;
  onDeleted: (receipt: string) => void;
}) {
  const taskId = task.id;
  // "Has an Executor" means one who holds the Task now; the Member who
  // finished it (#861) is named among the facts, not assignable again.
  const hasExecutor = task.executor?.isCurrent === true;
  const [menuAction, setMenuAction] = useState<MenuAction | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const evaluation = useRef<TaskEvaluationActions>(null);
  const canMarkUnfulfilled = useCanMarkUnfulfilled({
    taskId,
    status: task.status,
    kind: task.kind,
    overdue: task.overdue,
    hasExecutor,
  });
  const canCancel = canCancelTask(task.status, canManage);
  const canDuplicate = canManage && task.kind === 'task';
  const hasMenu = canCancel || canMarkUnfulfilled || canManage;
  const menuDialog = (action: MenuAction): MenuDialog => ({
    open: menuAction === action,
    onOpenChange: (open) => setMenuAction(open ? action : null),
    // The "⋯" button, not Duplică beside it.
    returnFocus: () =>
      menuRef.current?.querySelector<HTMLElement>(
        '[data-slot="action-menu"]',
      ) ?? null,
  });
  return (
    <div
      data-slot="task-actions"
      className="flex flex-wrap items-start gap-2 empty:hidden [&>*:has(form)]:basis-full [&>*:has([role=status])]:basis-full [&>[role=status]]:basis-full"
    >
      <TaskEditControl task={row} canManage={canManage} />
      <TaskAssignControl
        taskId={taskId}
        groupId={row.group_id}
        status={task.status}
        kind={task.kind}
        assignmentMode={task.assignmentMode}
        hasExecutor={hasExecutor}
        canManage={canManage}
      />
      <TaskEvaluationControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
        overdue={task.overdue}
        hasExecutor={hasExecutor}
        executorName={executorName}
        groupId={row.group_id}
        unfulfilledInMenu
        actions={evaluation}
      />
      <TaskFeedbackControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
      />
      <TaskReopenControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
      />
      {(canDuplicate || hasMenu) && (
        <div
          ref={menuRef}
          data-slot="task-more-actions"
          className="ml-auto flex shrink-0 items-center gap-2"
        >
          {canDuplicate && (
            <TaskDuplicateControl taskId={taskId} onDuplicated={onNavigate} />
          )}
          {/* Destructive last (#1017): the one act that cannot be undone,
              offered to the Task's managers in every status. */}
          <ActionMenu
            items={[
              canCancel && {
                label: 'Anulează taskul',
                icon: Ban,
                onSelect: () => setMenuAction('cancel'),
              },
              canMarkUnfulfilled && {
                label: 'Marchează nerealizat',
                icon: CircleX,
                onSelect: () => evaluation.current?.markUnfulfilled(),
              },
              canManage && {
                label: 'Șterge definitiv',
                icon: Trash2,
                destructive: true,
                onSelect: () => setMenuAction('delete'),
              },
            ]}
          />
        </div>
      )}
      {/* Their pop-ups and receipts; the menu above opens them. */}
      <TaskCancelControl
        taskId={taskId}
        status={task.status}
        kind={task.kind}
        canManage={canManage}
        menu={menuDialog('cancel')}
      />
      <TaskDeleteControl
        taskId={taskId}
        canManage={canManage}
        onDeleted={onDeleted}
        menu={menuDialog('delete')}
      />
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

/**
 * The details of the shown Task with its manager controls decided: the
 * Tasks the opener knows to be managed need no question; with `ask`, any
 * other is asked of the server (`can_manage_task`), and the controls arrive
 * with its answer.
 */
function ManagedTaskDetails({
  known,
  ask,
  ...details
}: Omit<ComponentProps<typeof TaskDetails>, 'canManage'> & {
  known: boolean;
  ask: boolean;
}) {
  const capability = useTaskManageCapability(details.taskId, ask && !known);
  return (
    <TaskDetails {...details} canManage={known || capability.data === true} />
  );
}

export function TaskDetailsSheet({
  taskId,
  managedTaskIds = new Set<number>(),
  askManage = false,
  notice = null,
  onClose,
  onDeleted,
}: {
  taskId: number | null;
  /** The Tasks the opener knows the viewer manages. */
  managedTaskIds?: ReadonlySet<number>;
  /**
   * Ask the server about a Task outside `managedTaskIds` (#1053): the
   * Tracker, whose lists hold their finished Tasks by the page and whose
   * links open any Task. Without it only the known ones have the controls.
   */
  askManage?: boolean;
  /** A confirmation for the opened Task, e.g. after it was just created. */
  notice?: string | null;
  onClose: () => void;
  /**
   * The shown Task was deleted for good (#1017): the sheet closes and the
   * list says so. Without it the sheet only closes.
   */
  onDeleted?: (receipt: string) => void;
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
          {/* Titled by the Task itself, its Group and status under it. */}
          <SheetHeader>
            <SheetTitle
              ref={titleRef}
              tabIndex={-1}
              className="wrap-anywhere outline-none"
            >
              {shownId === null ? (
                SHEET_TITLE
              ) : (
                <SheetTaskTitle taskId={shownId} />
              )}
            </SheetTitle>
            {shownId !== null && <SheetTaskChips taskId={shownId} />}
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
              <ManagedTaskDetails
                taskId={shownId}
                known={managedTaskIds.has(shownId)}
                ask={askManage}
                onNavigate={(id) => go(sheetTrailPush(current, id))}
                onDeleted={(receipt) => {
                  setTrail(null);
                  if (onDeleted) onDeleted(receipt);
                  else onClose();
                }}
              />
            )}
          </ReceiptTurnScope>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
