import { useId, type CSSProperties, type ReactNode } from 'react';
import { Clock, UserRound } from 'lucide-react';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { ListRow } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { formatPoints } from '../../lib/format';
import type { TaskProgressInput } from '../../queries/task-progress';
import type { OnGaveUp } from './give-up-receipt';
import { SubmissionNote } from './SubmissionNote';
import { showsExecutorLine } from './task-executor-line';
import { isTerminalTask, type TaskPresentation } from './task-presentation';
import { TaskExecutorActions } from './TaskExecutorActions';
import { TaskInterestControls } from './TaskInterestControls';
import {
  TaskEvaluationLine,
  TaskGroupChip,
  TaskStatusBadges,
} from './TaskParts';
import { TaskQueueStatus } from './TaskQueueStatus';
import { TaskStageSummary } from './TaskStageSummary';

type TaskRowProps = {
  task: TaskPresentation;
  /** Without it the title is plain text and the row opens nothing. */
  onOpenTask?: (id: number) => void;
  /**
   * The fuller row of Taskurile mele, Disponibile and the Member tracker:
   * under the meta line it adds the description on one line, the stage or
   * the Candidate's queue line, the Submission Note, the Attached Links and
   * `history`; the Executor shows by `showsExecutorLine`, and the Evaluation
   * names the Difficulty and the grade beside the points.
   */
  detailed?: boolean;
  allowInterest?: boolean;
  /**
   * With `allowInterest`: whether the Task Audience admits this Member. Only a
   * row the Member took part in can be listed without being joinable (another
   * Group's local Task, ruling R26), so the row says so where the join button
   * would be.
   */
  joinable?: boolean;
  /** The title's heading level: 3 when the row sits under a band heading. */
  titleLevel?: 2 | 3;
  /** The viewer; the Executor's own row offers Start, Submit and Give up. */
  memberId?: string | undefined;
  pending?: boolean;
  onProgress?: (input: TaskProgressInput) => Promise<unknown>;
  /**
   * The row carries `id="task-<id>"`, the target of `/tracker?task=<id>`.
   * Only the list that link lands on (Taskurile mele) sets it, so the id is
   * never repeated on a page.
   */
  anchor?: boolean;
  /** Set briefly when a deep link lands on this row. */
  highlighted?: boolean;
  /**
   * The read-only history variant (the Member tracker, R11): the row shows
   * this Assignment's own record in place of the Executor, the queue and
   * every action — nothing on it changes the Task.
   */
  history?: ReactNode;
  /** The list shows the give-up receipt; the row leaves it (Audit D-3). */
  onGaveUp?: OnGaveUp;
};

/**
 * The row's actions. Under `sm` they span the row under its content, full
 * width; from `sm` they sit at its right end, centred on its height, as wide
 * as their labels — two of them side by side from `md`, the primary one last.
 * Always above the title's stretched hit area. The give-up
 * reason form needs the width, so while it is open the cell drops back under
 * the content.
 */
const actionClass =
  'relative z-10 grid min-w-0 gap-2 pr-4 pb-3 pl-5 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:max-w-64 sm:self-center sm:py-3 sm:pl-0 sm:has-[form]:col-span-full sm:has-[form]:col-start-1 sm:has-[form]:row-span-1 sm:has-[form]:row-start-3 sm:has-[form]:max-w-none sm:has-[form]:pt-0 sm:has-[form]:pl-5 md:flex md:max-w-none md:flex-row-reverse md:items-center md:has-[form]:grid md:[&_button]:w-auto md:[&_button]:whitespace-nowrap';

/** What the queue says; with nothing to say it leaves no gap. */
const queueClass = 'space-y-2 empty:hidden';

function RowActions({ children }: { children?: ReactNode }) {
  return (
    <div data-slot="task-row-actions" className={actionClass}>
      {children}
    </div>
  );
}

/**
 * One Task, everywhere a Task is listed — Taskurile mele, Disponibile, De
 * gestionat, Toate and the Member tracker. By the user's decision of
 * 2026-10-11 the row is the Task in every list, reversing the split of
 * ruling R10 (#687), which kept cards for a Member's own lists and rows for
 * the managers'. It sits on `ListRow` (#846, layout T1/X14): the Group
 * stripe, the title across the row's whole width — so it wraps where its
 * words do, never into three short lines beside a value column — and one
 * meta line under it (the row's footer), always in this order: Group chip ·
 * status, then the short deadline · the Executor by avatar and name, and the
 * points at the line's end. Each unit wraps whole; the status never sits
 * beside the title. `detailed` adds what a Member's own lists say under that
 * line.
 *
 * The whole row opens the details sheet: the title is the button, and its
 * hit area is stretched over the row. The Executor's name stays its own
 * button (their Member Card) above that area, and so do the row's actions
 * and links.
 */
export function TaskRow({
  task,
  onOpenTask,
  detailed = false,
  allowInterest = false,
  joinable = true,
  titleLevel = 2,
  memberId,
  pending = false,
  onProgress,
  anchor = false,
  highlighted = false,
  history,
  onGaveUp,
}: TaskRowProps) {
  const readOnly = history !== undefined;
  const titleId = useId();
  // The viewer holds this Task: no queue news for them (relevance B14).
  const ownTask =
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId;
  // Colour is never the only carrier: the chip names the Group.
  const stripe = task.origin.color ?? 'var(--ink-400)';
  const Title = titleLevel === 3 ? 'h3' : 'h2';
  // A finished Task names who finished it (#861), or nothing: a cancelled
  // Task never reads "Neatribuit".
  const showsExecutor = detailed
    ? !readOnly && showsExecutorLine(task, memberId)
    : task.kind === 'task' &&
      !(isTerminalTask(task.status) && task.executor === null);
  // Queue lines are for a Candidate: never on the Executor's own row (B14),
  // never on a finished Task, where "Ai fost selectat" or "Te-ai retras" is
  // history (Audit D-1).
  const candidate =
    detailed &&
    !readOnly &&
    task.assignmentMode === 'public' &&
    !ownTask &&
    !isTerminalTask(task.status);
  const queueOpen =
    candidate &&
    allowInterest &&
    !task.queueClosed &&
    ['todo', 'in_progress', 'in_review'].includes(task.status);

  /** The row around what the queue says and the actions at its end. */
  const frame = (queue: ReactNode, actions: ReactNode) => (
    <article
      id={anchor ? `task-${task.id}` : undefined}
      aria-labelledby={titleId}
      data-slot="task-row"
      data-overdue={task.overdue || undefined}
      data-highlighted={highlighted || undefined}
      className="relative grid min-w-0 scroll-mt-24 grid-cols-1 overflow-hidden rounded-md border border-border bg-card transition-[background-color,border-color,box-shadow] motion-reduce:transition-none data-highlighted:ring-3 data-highlighted:ring-primary data-highlighted:ring-offset-2 data-highlighted:ring-offset-background data-overdue:border-destructive/40 has-[[data-slot=task-row-open]:hover]:bg-[color-mix(in_oklab,var(--muted)_55%,var(--card))] has-[[data-slot=task-row-open]:focus-visible]:outline-2 has-[[data-slot=task-row-open]:focus-visible]:outline-offset-2 has-[[data-slot=task-row-open]:focus-visible]:outline-ring has-[[data-slot=task-row-open]:focus-visible]:outline-solid sm:grid-cols-[minmax(0,1fr)_auto]"
      style={{ '--task-stripe': stripe } as CSSProperties}
    >
      <span
        aria-hidden="true"
        data-slot="task-stripe"
        className="absolute inset-y-0 left-0 w-1.5 bg-(--task-stripe)"
      />
      <ListRow
        as="div"
        footer={
          <div className="grid min-w-0 gap-2 text-sm">
            <div
              data-slot="task-row-meta"
              className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
            >
              {/* Three units — where the Task stands, when and who, its
                  points — so a row breaks between them, never inside one. */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <TaskGroupChip task={task} />
                <TaskStatusBadges task={task} />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <p className="m-0 flex min-w-0 items-center gap-1.5">
                  <Clock
                    aria-hidden="true"
                    className={
                      task.overdue
                        ? 'size-4 shrink-0 text-destructive'
                        : 'size-4 shrink-0 text-muted-foreground'
                    }
                  />
                  <span className="sr-only">Termen: </span>
                  {task.deadline ? (
                    <time
                      dateTime={task.deadline}
                      className={
                        task.overdue
                          ? 'font-semibold text-destructive tabular-nums'
                          : 'tabular-nums'
                      }
                    >
                      {task.deadlineLabel}
                    </time>
                  ) : (
                    <span className="text-muted-foreground">
                      {task.deadlineLabel}
                    </span>
                  )}
                </p>
                {showsExecutor && (
                  <p className="m-0 flex min-w-0 items-center gap-1.5">
                    <span className="sr-only">Executor:</span>
                    {/* Only an identity #499's lookup returned becomes a name
                        button; an Executor known by id alone stays anonymous. */}
                    {task.executor?.name ? (
                      <MemberName
                        size="sm"
                        className="relative z-10"
                        memberId={task.executor.memberId}
                        nickname={task.executor.nickname}
                        fullName={task.executor.name}
                      />
                    ) : (
                      <>
                        <UserRound
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 text-muted-foreground">
                          {task.executor ? 'Nume indisponibil' : 'Neatribuit'}
                        </span>
                      </>
                    )}
                  </p>
                )}
              </div>
              {detailed ? (
                <TaskEvaluationLine task={task} className="ml-auto" />
              ) : (
                task.points !== null && (
                  <p
                    data-slot="task-row-points"
                    className="m-0 ml-auto flex shrink-0 items-baseline gap-1 tabular-nums"
                  >
                    <span className="text-base font-bold">
                      {formatPoints(task.points)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      puncte
                    </span>
                  </p>
                )
              )}
            </div>
            {detailed && (
              <>
                {/* One line: the details sheet has the whole text. */}
                {task.description && (
                  <p
                    data-slot="task-row-description"
                    className="m-0 line-clamp-1 wrap-anywhere text-muted-foreground"
                  >
                    {task.description}
                  </p>
                )}
                {!readOnly && (task.assignmentMode !== 'public' || ownTask) && (
                  <TaskStageSummary task={task} />
                )}
                {queue}
                {/* The latest Submission Note, while the Task is in review. */}
                {!readOnly &&
                  task.status === 'in_review' &&
                  task.submission && (
                    <SubmissionNote
                      submission={task.submission}
                      className="relative z-10"
                    />
                  )}
                {/* R46: the bare label in a list. */}
                <AttachedLinksList
                  links={task.links}
                  variant="card"
                  buttonClassName="relative z-10 max-w-full text-left wrap-anywhere"
                />
                {readOnly && (
                  <div data-slot="task-row-history" className="min-w-0">
                    {history}
                  </div>
                )}
              </>
            )}
          </div>
        }
        className="items-start gap-x-4 gap-y-2 py-3 pr-4 pl-5"
      >
        <Title
          id={titleId}
          data-slot="task-title"
          // The `?task=` link focuses a title that is not a button.
          tabIndex={-1}
          className="m-0 text-base leading-snug font-semibold wrap-break-word outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          {onOpenTask ? (
            <button
              type="button"
              data-slot="task-row-open"
              className="cursor-pointer text-left outline-none after:absolute after:inset-0 after:content-['']"
              onClick={() => onOpenTask(task.id)}
            >
              {task.title}
            </button>
          ) : (
            task.title
          )}
        </Title>
      </ListRow>
      {actions}
    </article>
  );

  if (queueOpen && joinable)
    return (
      <TaskInterestControls taskId={task.id} task={task}>
        {({ status, action }) =>
          frame(
            <div data-slot="task-row-queue" className={queueClass}>
              {status}
            </div>,
            action && <RowActions>{action}</RowActions>,
          )
        }
      </TaskInterestControls>
    );

  return frame(
    candidate &&
      (queueOpen ? (
        <div data-slot="task-row-queue" className={queueClass}>
          <TaskStageSummary task={task} />
          <p
            data-slot="audience-notice"
            className="m-0 font-medium text-foreground"
          >
            Doar pentru membrii grupului
          </p>
        </div>
      ) : (
        <div data-slot="task-row-queue" className={queueClass}>
          <TaskQueueStatus taskId={task.id} task={task} />
        </div>
      )),
    !readOnly && onProgress && (
      <TaskExecutorActions
        task={task}
        memberId={memberId}
        pending={pending}
        onProgress={onProgress}
        onGaveUp={onGaveUp}
        as={RowActions}
        // The receipt and the error read under the row's content.
        messagesClassName="space-y-2 pr-4 pb-3 pl-5 sm:col-start-1 sm:row-start-2"
      />
    ),
  );
}
