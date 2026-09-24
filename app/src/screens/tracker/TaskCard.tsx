import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarClock, UserRound } from 'lucide-react';
import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
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
import type { TaskPresentation } from './task-presentation';
import type { TaskProgressInput } from '../../queries/task-progress';
import { TaskActionSuccess } from './TaskActionSuccess';
import { TaskInterestControls } from './TaskInterestControls';
import { TaskQueueStatus } from './TaskQueueStatus';
import { TaskStageSummary } from './TaskStageSummary';
import { TaskGiveUpControl } from './TaskGiveUpControl';
import { SubmitForReviewDialog } from './SubmitForReviewDialog';
import { SubmissionNote } from './SubmissionNote';

type TaskCardProps = {
  task: TaskPresentation;
  allowInterest?: boolean;
  /**
   * With `allowInterest`: whether the Task Audience admits this Member. A
   * local-Audience Other OSUBB Opportunity is not joinable, so the card says
   * so where the join button would be (ruling R10).
   */
  joinable?: boolean;
  /**
   * Disponibile's band: `other` greys the card — a neutral stripe, border and
   * surface — while its chip still names the Group (ruling R10).
   */
  band?: 'own' | 'other';
  /** The title's heading level: 3 when the card sits under a band heading. */
  titleLevel?: 2 | 3;
  onOpenTask?: (id: number) => void;
  /** The viewer; the Executor's own card offers Start, Submit and Give up. */
  memberId?: string | undefined;
  pending?: boolean;
  onProgress?: (input: TaskProgressInput) => Promise<unknown>;
  /**
   * The list's copy of a card carries `id="task-<id>"`, the target of
   * `/tracker?task=<id>`; the details sheet's copy must not repeat it.
   */
  anchor?: boolean;
  /** Set briefly when a deep link lands on this card. */
  highlighted?: boolean;
  /**
   * The card shows the latest Submission Note while the Task is in review;
   * the details sheet shows it on its own, whenever one exists.
   */
  showSubmissionNote?: boolean;
  /**
   * The read-only history variant (the Member tracker, R11): the card shows
   * this Assignment's own record in place of the Executor line, the queue and
   * every action — nothing on it changes the Task.
   */
  history?: ReactNode;
};

const chipClass =
  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground';

/**
 * The chip naming the Task's Group, its dot in the `--task-stripe` colour the
 * surrounding card or row sets. Colour is never the only carrier: the chip
 * names the Group.
 */
export function TaskGroupChip({ task }: { task: TaskPresentation }) {
  return (
    <span className={chipClass}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-(--task-stripe)"
      />
      <span className="min-w-0 wrap-anywhere">{task.origin.label}</span>
    </span>
  );
}

/** The status badge with the overdue, feedback and late badges beside it. */
export function TaskStatusBadges({ task }: { task: TaskPresentation }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
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

export function TaskCard({
  task,
  allowInterest = false,
  joinable = true,
  band,
  titleLevel = 2,
  onOpenTask,
  memberId,
  pending = false,
  onProgress,
  anchor = true,
  highlighted = false,
  showSubmissionNote = true,
  history,
}: TaskCardProps) {
  const readOnly = history !== undefined;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const titleId = useId();
  const isExecutor =
    !readOnly &&
    onProgress !== undefined &&
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId;
  const action = isExecutor
    ? task.status === 'todo'
      ? 'start'
      : task.status === 'in_progress'
        ? 'submit'
        : null
    : null;
  const canGiveUp =
    isExecutor && (task.status === 'todo' || task.status === 'in_progress');
  // Colour is never the only carrier: the first chip names the Group.
  const other = band === 'other';
  const stripe = other
    ? 'var(--ink-300)'
    : (task.origin.color ?? 'var(--ink-400)');
  const Title = titleLevel === 3 ? 'h3' : 'h2';

  async function start() {
    if (pending || saving || !onProgress) return;
    setSaving(true);
    setError(null);
    try {
      await onProgress({ taskId: task.id, action: 'start' });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Nu am putut salva schimbarea. Încearcă din nou.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      id={anchor ? `task-${task.id}` : undefined}
      aria-labelledby={titleId}
      data-highlighted={highlighted || undefined}
      data-band={band}
      className="h-full min-w-0 scroll-mt-24 rounded-xl data-highlighted:ring-3 data-highlighted:ring-primary data-highlighted:ring-offset-2 data-highlighted:ring-offset-background motion-safe:transition-shadow motion-safe:duration-300"
    >
      <Card
        className={cn(
          'relative h-full pl-1.5',
          // Greyed by surface and border only — never opacity, so every
          // word keeps its full contrast.
          other &&
            'bg-muted shadow-none ring-0 border border-dashed border-border',
        )}
        style={{ '--task-stripe': stripe } as CSSProperties}
      >
        <span
          aria-hidden="true"
          data-slot="task-stripe"
          className="absolute inset-y-0 left-0 w-1.5 bg-(--task-stripe)"
        />
        <CardHeader className="min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <TaskGroupChip task={task} />
            {task.audience === 'org' && (
              <span className={chipClass}>OSUBB</span>
            )}
            {task.campaign && (
              <span className={chipClass}>
                <span className="min-w-0 wrap-anywhere">
                  Campanie: {task.campaign.name}
                </span>
              </span>
            )}
            {task.parent && (
              <span className={chipClass}>
                <span className="min-w-0 wrap-anywhere">
                  Subtask din: {task.parent.title}
                </span>
              </span>
            )}
          </div>
          <Title
            id={titleId}
            data-slot="task-title"
            tabIndex={-1}
            className="text-lg leading-snug font-semibold wrap-anywhere outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            {onOpenTask ? (
              <Button
                variant="link"
                className="h-auto min-h-11 min-w-11 p-0 text-left text-lg leading-snug font-semibold whitespace-normal wrap-anywhere text-foreground"
                onClick={() => onOpenTask(task.id)}
              >
                {task.title}
              </Button>
            ) : (
              task.title
            )}
          </Title>
          <TaskStatusBadges task={task} />
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          <div className="grid gap-1.5 text-sm">
            <p className="flex min-w-0 items-center gap-2">
              <CalendarClock
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                <span className="font-medium">Termen: </span>
                {task.deadline ? (
                  <time
                    dateTime={task.deadline}
                    className={
                      task.overdue ? 'font-semibold text-destructive' : ''
                    }
                  >
                    {task.deadlineLabel} (ora României)
                  </time>
                ) : (
                  task.deadlineLabel
                )}
              </span>
            </p>
            {task.kind === 'task' && !readOnly && (
              <p className="flex min-w-0 flex-wrap items-center gap-x-2">
                <UserRound
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="font-medium">Executor:</span>
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
                  <span className="min-w-0 wrap-anywhere">
                    {task.executor ? 'Nume indisponibil' : 'Neatribuit'}
                  </span>
                )}
              </p>
            )}
          </div>
          {task.description && (
            <p className="text-sm whitespace-pre-wrap wrap-anywhere">
              {task.description}
            </p>
          )}
          {!readOnly && task.assignmentMode !== 'public' && (
            <TaskStageSummary task={task} />
          )}
          {!readOnly &&
            task.assignmentMode === 'public' &&
            (allowInterest &&
            !task.queueClosed &&
            ['todo', 'in_progress', 'in_review'].includes(task.status) ? (
              joinable ? (
                <TaskInterestControls taskId={task.id} task={task} />
              ) : (
                <div className="space-y-3">
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
          {!readOnly &&
            showSubmissionNote &&
            task.status === 'in_review' &&
            task.submission && <SubmissionNote submission={task.submission} />}
          {task.link && (
            <AttachedLinkButton
              label={task.link.label}
              url={task.link.url}
              className="max-w-full text-left wrap-anywhere"
            />
          )}
          {task.points !== null && (
            <p className="text-sm font-medium tabular-nums">
              {formatPoints(task.points)} puncte · Dificultate {task.difficulty}{' '}
              · Nota {task.rating}
            </p>
          )}
          {history}
          {notice && <TaskActionSuccess>{notice}</TaskActionSuccess>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        {(action || canGiveUp) && (
          <CardFooter className="mt-auto flex flex-wrap gap-2">
            {action === 'start' && (
              <Button
                className="min-h-11 min-w-11 w-full whitespace-normal sm:w-auto"
                disabled={pending || saving}
                onClick={start}
              >
                {pending || saving ? 'Se salvează…' : 'Începe taskul'}
              </Button>
            )}
            {action === 'submit' && onProgress && (
              <SubmitForReviewDialog
                pending={pending}
                onSubmit={(submission) =>
                  onProgress({
                    taskId: task.id,
                    action: 'submit',
                    ...submission,
                  })
                }
                onSuccess={() =>
                  setNotice('Taskul a fost trimis la verificare.')
                }
              />
            )}
            {canGiveUp && <TaskGiveUpControl taskId={task.id} />}
          </CardFooter>
        )}
      </Card>
    </article>
  );
}
