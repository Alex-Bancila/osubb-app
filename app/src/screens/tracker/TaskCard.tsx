import { useId, type CSSProperties, type ReactNode } from 'react';
import { Clock, UserRound } from 'lucide-react';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { MemberName } from '../../components/member/MemberName';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '../../components/ui/card';
import { formatPoints } from '../../lib/format';
import { cn } from '../../lib/utils';
import { isTerminalTask, type TaskPresentation } from './task-presentation';
import { showsExecutorLine } from './task-executor-line';
import type { TaskProgressInput } from '../../queries/task-progress';
import { TaskExecutorActions } from './TaskExecutorActions';
import { TaskInterestControls } from './TaskInterestControls';
import { TaskQueueStatus } from './TaskQueueStatus';
import { TaskStageSummary } from './TaskStageSummary';
import type { OnGaveUp } from './give-up-receipt';
import { SubmissionNote } from './SubmissionNote';
import { DifficultyMark } from '../../components/tasks/DifficultyMark';

type TaskCardProps = {
  task: TaskPresentation;
  allowInterest?: boolean;
  /**
   * With `allowInterest`: whether the Task Audience admits this Member. Only a
   * row the Member took part in can be listed without being joinable (another
   * Group's local Task, ruling R26), so the card says so where the join button
   * would be.
   */
  joinable?: boolean;
  /** The title's heading level: 3 when the card sits under a band heading. */
  titleLevel?: 2 | 3;
  onOpenTask?: (id: number) => void;
  /** The viewer; the Executor's own card offers Start, Submit and Give up. */
  memberId?: string | undefined;
  pending?: boolean;
  onProgress?: (input: TaskProgressInput) => Promise<unknown>;
  /**
   * The list's copy of a card carries `id="task-<id>"`, the target of
   * `/tracker?task=<id>`; a copy elsewhere (Acasă) must not repeat it.
   */
  anchor?: boolean;
  /** Set briefly when a deep link lands on this card. */
  highlighted?: boolean;
  /**
   * The read-only history variant (the Member tracker, R11): the card shows
   * this Assignment's own record in place of the Executor, the queue and
   * every action — nothing on it changes the Task.
   */
  history?: ReactNode;
  /** The list shows the give-up receipt; the card leaves it (Audit D-3). */
  onGaveUp?: OnGaveUp;
};

const chipClass =
  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground';

/**
 * The chip naming the Task's Group, its dot in the `--task-stripe` colour the
 * surrounding card or row sets. Colour is never the only carrier: the chip
 * names the Group. `truncate` keeps it on one line.
 */
export function TaskGroupChip({
  task,
  truncate = false,
  className,
}: {
  task: TaskPresentation;
  truncate?: boolean;
  className?: string | undefined;
}) {
  return (
    <span className={cn(chipClass, className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-(--task-stripe)"
      />
      <span className={truncate ? 'min-w-0 truncate' : 'min-w-0 wrap-anywhere'}>
        {task.origin.label}
      </span>
      <PrivateGroupBadge isPrivate={task.origin.isPrivate} compact />
    </span>
  );
}

/**
 * Where a Task comes from, as one muted line under its title: the Group's
 * colour dot and name, then its Campaign, its organization-wide Audience and
 * its Umbrella, each after a "·". It wraps rather than cutting a name short.
 * Colour is never the only carrier: the line names the Group.
 */
function TaskOriginLine({ task }: { task: TaskPresentation }) {
  const dot = (
    <span aria-hidden="true" className="text-muted-foreground/70">
      ·
    </span>
  );
  return (
    <p
      data-slot="task-origin"
      className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-(--task-stripe)"
      />
      <span className="min-w-0 wrap-anywhere">{task.origin.label}</span>
      <PrivateGroupBadge isPrivate={task.origin.isPrivate} compact />
      {task.campaign && (
        <>
          {dot}
          <span className="min-w-0 wrap-anywhere">
            <span className="sr-only">Campanie: </span>
            {task.campaign.name}
          </span>
        </>
      )}
      {/* A direct Task is local only (R26): its Audience means nothing. */}
      {task.assignmentMode === 'public' && task.audience === 'org' && (
        <>
          {dot}
          <span>
            <span className="sr-only">Audiență: </span>
            OSUBB
          </span>
        </>
      )}
      {task.parent && (
        <>
          {dot}
          <span className="min-w-0 wrap-anywhere">
            Subtask din: {task.parent.title}
          </span>
        </>
      )}
    </p>
  );
}

/**
 * A Task's Evaluation on one line: the points, the Difficulty as its mark and
 * the grade. Shown only once the Task has points.
 */
export function TaskEvaluationLine({
  task,
  className,
}: {
  task: TaskPresentation;
  className?: string;
}) {
  if (task.points === null) return null;
  return (
    <p
      data-slot="task-evaluation"
      className={cn(
        'm-0 flex min-w-0 flex-wrap items-center gap-x-2 tabular-nums',
        className,
      )}
    >
      <span className="font-semibold">{formatPoints(task.points)} puncte</span>
      {task.difficulty === null ? (
        <span>
          <span className="sr-only">Dificultate </span>—
        </span>
      ) : (
        <DifficultyMark value={task.difficulty} />
      )}
      <span>Nota {task.rating ?? '—'}</span>
    </p>
  );
}

/** The status badge with the overdue, feedback and late badges beside it. */
export function TaskStatusBadges({
  task,
  className,
}: {
  task: TaskPresentation;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      <Badge
        variant={task.status === 'unfulfilled' ? 'destructive' : 'outline'}
      >
        {task.statusLabel}
      </Badge>
      {task.overdue && <Badge variant="destructive">Termen depășit</Badge>}
      {task.feedbackPending && (
        <Badge variant="secondary">Modificări cerute</Badge>
      )}
      {task.completedLate && (
        <Badge variant="secondary">Finalizat cu întârziere</Badge>
      )}
    </div>
  );
}

/**
 * One Task as a card (layout T2): the title with its status beside it, the
 * Group and Campaign as one muted line, then one meta row — the deadline in
 * the short form, the Executor, and the Evaluation once there is one. Nothing
 * has a reserved height, so a one-line title leaves no empty band.
 */
export function TaskCard({
  task,
  allowInterest = false,
  joinable = true,
  titleLevel = 2,
  onOpenTask,
  memberId,
  pending = false,
  onProgress,
  anchor = true,
  highlighted = false,
  history,
  onGaveUp,
}: TaskCardProps) {
  const readOnly = history !== undefined;
  const titleId = useId();
  // The viewer holds this Task: no queue news for them (relevance B14).
  const ownTask =
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId;
  // Colour is never the only carrier: the line under the title names the Group.
  const stripe = task.origin.color ?? 'var(--ink-400)';
  const Title = titleLevel === 3 ? 'h3' : 'h2';

  return (
    <article
      id={anchor ? `task-${task.id}` : undefined}
      aria-labelledby={titleId}
      data-highlighted={highlighted || undefined}
      className="h-full min-w-0 scroll-mt-24 rounded-md data-highlighted:ring-3 data-highlighted:ring-primary data-highlighted:ring-offset-2 data-highlighted:ring-offset-background motion-safe:transition-shadow motion-safe:duration-300"
    >
      <Card
        className="relative h-full gap-2 pl-1.5"
        style={{ '--task-stripe': stripe } as CSSProperties}
      >
        <span
          aria-hidden="true"
          data-slot="task-stripe"
          className="absolute inset-y-0 left-0 w-1.5 bg-(--task-stripe)"
        />
        <CardHeader className="min-w-0 gap-0">
          {/* The status sits on the title's row and drops under it only when
              the two no longer fit side by side. */}
          <div
            data-slot="task-heading"
            className="flex min-w-0 flex-wrap items-start justify-between gap-x-3"
          >
            <Title
              id={titleId}
              data-slot="task-title"
              tabIndex={-1}
              className="m-0 min-w-0 flex-1 basis-48 text-lg leading-snug font-semibold wrap-anywhere outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
            >
              {onOpenTask ? (
                <Button
                  variant="link"
                  className="h-auto min-h-11 min-w-11 justify-start p-0 text-left text-lg leading-snug font-semibold whitespace-normal wrap-anywhere text-foreground"
                  onClick={() => onOpenTask(task.id)}
                >
                  {task.title}
                </Button>
              ) : (
                <span className="flex min-h-11 items-center">{task.title}</span>
              )}
            </Title>
            <TaskStatusBadges
              task={task}
              className="min-h-11 shrink-0 items-center"
            />
          </div>
          <TaskOriginLine task={task} />
        </CardHeader>
        <CardContent className="min-w-0 space-y-2">
          <div
            data-slot="task-meta"
            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          >
            <p className="m-0 flex min-w-0 items-center gap-1.5">
              <Clock
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0',
                  task.overdue ? 'text-destructive' : 'text-muted-foreground',
                )}
              />
              <span className="sr-only">Termen: </span>
              {task.deadline ? (
                <time
                  dateTime={task.deadline}
                  className={cn(
                    'tabular-nums',
                    task.overdue && 'font-semibold text-destructive',
                  )}
                >
                  {task.deadlineLabel}
                </time>
              ) : (
                <span className="text-muted-foreground">
                  {task.deadlineLabel}
                </span>
              )}
            </p>
            {!readOnly && showsExecutorLine(task, memberId) && (
              <p className="m-0 flex min-w-0 items-center gap-1.5">
                <span className="sr-only">Executor:</span>
                {/* Only an identity #499's lookup returned becomes a name
                    button; an Executor known by id alone stays anonymous. */}
                {task.executor?.name ? (
                  <MemberName
                    size="sm"
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
                    <span className="min-w-0 wrap-anywhere">
                      {task.executor ? 'Nume indisponibil' : 'Neatribuit'}
                    </span>
                  </>
                )}
              </p>
            )}
            <TaskEvaluationLine task={task} className="ml-auto" />
          </div>
          {/* Two lines at most: the details sheet has the whole text. */}
          {task.description && (
            <p className="line-clamp-2 text-sm whitespace-pre-wrap wrap-anywhere text-muted-foreground">
              {task.description}
            </p>
          )}
          {!readOnly && (task.assignmentMode !== 'public' || ownTask) && (
            <TaskStageSummary task={task} />
          )}
          {/* Queue lines are for a Candidate: never on the Executor's own
              card (B14), never on a finished Task, where "Ai fost selectat"
              or "Te-ai retras" is history (Audit D-1). */}
          {!readOnly &&
            task.assignmentMode === 'public' &&
            !ownTask &&
            !isTerminalTask(task.status) &&
            (allowInterest &&
            !task.queueClosed &&
            ['todo', 'in_progress', 'in_review'].includes(task.status) ? (
              joinable ? (
                <TaskInterestControls taskId={task.id} task={task} />
              ) : (
                <div className="space-y-2">
                  <TaskStageSummary task={task} />
                  <p
                    data-slot="audience-notice"
                    className="text-sm font-medium text-foreground"
                  >
                    Doar pentru membrii grupului
                  </p>
                </div>
              )
            ) : (
              <TaskQueueStatus taskId={task.id} task={task} />
            ))}
          {/* The latest Submission Note, while the Task is in review. */}
          {!readOnly && task.status === 'in_review' && task.submission && (
            <SubmissionNote submission={task.submission} />
          )}
          {/* R46: the bare label on a card. */}
          <AttachedLinksList
            links={task.links}
            variant="card"
            buttonClassName="max-w-full text-left wrap-anywhere"
          />
          {history}
        </CardContent>
        {!readOnly && (
          // One column of full-width actions: equal widths, no ragged wrap
          // (layout T3); `mt-auto` keeps the footer on the card's bottom edge.
          <TaskExecutorActions
            task={task}
            memberId={memberId}
            pending={pending}
            onProgress={onProgress}
            onGaveUp={onGaveUp}
            as={CardFooter}
            className="mt-auto grid grid-cols-1 gap-2"
            messagesClassName="space-y-2 px-(--card-spacing)"
          />
        )}
      </Card>
    </article>
  );
}
