import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { CalendarClock, UserRound } from 'lucide-react';
import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
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
import { chipsThatFit } from './task-chips';
import type { TaskProgressInput } from '../../queries/task-progress';
import { TaskActionSuccess } from './TaskActionSuccess';
import { TaskInterestControls } from './TaskInterestControls';
import { TaskQueueStatus } from './TaskQueueStatus';
import { TaskStageSummary } from './TaskStageSummary';
import { TaskGiveUpControl } from './TaskGiveUpControl';
import { gaveUpReceipt, type OnGaveUp } from './give-up-receipt';
import { useReceiptTurn } from './receipt-turn';
import { SubmitForReviewDialog } from './SubmitForReviewDialog';
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
  /**
   * The details sheet's copy: every chip shows (nothing to line up with),
   * and the Audience chip gives way to the sheet's Audiență row (B20).
   */
  inSheet?: boolean;
  /** The list shows the give-up receipt; the card leaves it (Audit D-3). */
  onGaveUp?: OnGaveUp;
};

const chipClass =
  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground';

/**
 * The chip naming the Task's Group, its dot in the `--task-stripe` colour the
 * surrounding card or row sets. Colour is never the only carrier: the chip
 * names the Group. `truncate` keeps it on one line (the card's chip line).
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

/** A chip after the Group's: the Audience, the Campaign, the Umbrella. */
type ExtraChip = { key: string; label: string };

function extraChips(
  task: TaskPresentation,
  audienceChip: boolean,
): ExtraChip[] {
  const chips: ExtraChip[] = [];
  // A direct Task is local only (R26): its Audience means nothing.
  if (
    audienceChip &&
    task.assignmentMode === 'public' &&
    task.audience === 'org'
  )
    chips.push({ key: 'audience', label: 'OSUBB' });
  if (task.campaign)
    chips.push({ key: 'campaign', label: `Campanie: ${task.campaign.name}` });
  if (task.parent)
    chips.push({ key: 'parent', label: `Subtask din: ${task.parent.title}` });
  return chips;
}

/**
 * The card's chip area: exactly one line in a list, so every card in a row
 * starts its title at the same height (layout T2). Chips that do not fit
 * collapse into "+n", which names them to a screen reader and on hover. In
 * the details sheet (`wrap`) nothing needs to line up, so every chip shows.
 */
function TaskChips({
  task,
  wrap,
  audienceChip,
}: {
  task: TaskPresentation;
  wrap: boolean;
  audienceChip: boolean;
}) {
  const extras = extraChips(task, audienceChip);
  const lineRef = useRef<HTMLDivElement>(null);
  // Natural chip widths, read once from the first (all-chips) render; the
  // caller remounts this line when a label changes.
  const [widths, setWidths] = useState<number[] | null>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (wrap || !line) return;
    if (widths === null) {
      setWidths(
        [...line.children].map((child) => child.getBoundingClientRect().width),
      );
      setAvailable(line.clientWidth);
      return;
    }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setAvailable(line.clientWidth));
    observer.observe(line);
    return () => observer.disconnect();
  }, [wrap, widths]);
  // A first measure may use the fallback font; once the web font is in,
  // measure the chips again (once — this effect does not follow `widths`).
  useEffect(() => {
    if (wrap || typeof document === 'undefined' || !document.fonts) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setWidths(null);
    });
    return () => {
      live = false;
    };
  }, [wrap]);
  const measuring = widths === null;
  const shown = measuring ? extras.length + 1 : chipsThatFit(widths, available);

  if (wrap)
    return (
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <TaskGroupChip task={task} />
        {extras.map((chip) => (
          <span key={chip.key} className={chipClass}>
            <span className="min-w-0 wrap-anywhere">{chip.label}</span>
          </span>
        ))}
      </div>
    );

  const visible = extras.slice(0, Math.max(0, shown - 1));
  const hidden = extras.slice(visible.length);
  // While measuring every chip keeps its natural width. After, only the last
  // chip shown gives way (truncates); the ones before it keep theirs (F-5).
  const fixed = (last: boolean) => measuring || !last;
  return (
    <div
      ref={lineRef}
      data-slot="task-chips"
      className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden"
    >
      <TaskGroupChip
        task={task}
        truncate={!measuring}
        className={fixed(visible.length === 0) ? 'shrink-0' : undefined}
      />
      {visible.map((chip, index) => (
        <span
          key={chip.key}
          title={chip.label}
          className={cn(
            chipClass,
            fixed(index === visible.length - 1) && 'shrink-0',
          )}
        >
          <span className="min-w-0 truncate">{chip.label}</span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          data-slot="task-chips-more"
          className={`${chipClass} shrink-0 tabular-nums`}
          title={hidden.map((chip) => chip.label).join(' · ')}
        >
          <span aria-hidden="true">+{hidden.length}</span>
          <span className="sr-only">
            {hidden.map((chip) => chip.label).join(', ')}
          </span>
        </span>
      )}
    </div>
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
  titleLevel = 2,
  onOpenTask,
  memberId,
  pending = false,
  onProgress,
  anchor = true,
  highlighted = false,
  showSubmissionNote = true,
  history,
  inSheet = false,
  onGaveUp,
}: TaskCardProps) {
  const readOnly = history !== undefined;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNoticeState] = useState<string | null>(null);
  const noticeTurn = useReceiptTurn();
  const setNotice = (text: string | null) => {
    setNoticeState(text);
    if (text) noticeTurn.claim();
  };
  const titleId = useId();
  const isExecutor =
    !readOnly &&
    onProgress !== undefined &&
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId &&
    // Who finished a Task (#861) no longer holds it: no actions.
    task.executor.isCurrent;
  const action = isExecutor
    ? task.status === 'todo'
      ? 'start'
      : task.status === 'in_progress'
        ? 'submit'
        : null
    : null;
  const canGiveUp =
    isExecutor && (task.status === 'todo' || task.status === 'in_progress');
  // The viewer holds this Task: no queue news for them (relevance B14).
  const ownTask =
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId;
  // Colour is never the only carrier: the first chip names the Group.
  const stripe = task.origin.color ?? 'var(--ink-400)';
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
      className="h-full min-w-0 scroll-mt-24 rounded-md data-highlighted:ring-3 data-highlighted:ring-primary data-highlighted:ring-offset-2 data-highlighted:ring-offset-background motion-safe:transition-shadow motion-safe:duration-300"
    >
      <Card
        className="relative h-full pl-1.5"
        style={{ '--task-stripe': stripe } as CSSProperties}
      >
        <span
          aria-hidden="true"
          data-slot="task-stripe"
          className="absolute inset-y-0 left-0 w-1.5 bg-(--task-stripe)"
        />
        <CardHeader className="min-w-0 gap-3">
          <TaskChips
            // A new label set is measured afresh.
            key={[
              task.origin.label,
              task.audience,
              task.campaign?.name,
              task.parent?.title,
            ].join('|')}
            task={task}
            wrap={inSheet}
            audienceChip={!inSheet}
          />
          <Title
            id={titleId}
            data-slot="task-title"
            tabIndex={-1}
            className="text-lg leading-snug font-semibold wrap-anywhere outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
          >
            {onOpenTask ? (
              <Button
                variant="link"
                className="h-auto min-h-11 min-w-11 items-start justify-start p-0 text-left text-lg leading-snug font-semibold whitespace-normal wrap-anywhere text-foreground"
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
            {!readOnly && showsExecutorLine(task, memberId) && (
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
              {formatPoints(task.points)} puncte ·{' '}
              {task.difficulty === null ? (
                'Dificultate —'
              ) : (
                <DifficultyMark value={task.difficulty} label="Dificultate" />
              )}{' '}
              · Nota {task.rating ?? '—'}
            </p>
          )}
          {history}
          {notice && noticeTurn.current && (
            <TaskActionSuccess>{notice}</TaskActionSuccess>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        {(action || canGiveUp) && (
          // One column of full-width actions: equal widths, no ragged wrap
          // (layout T3); `mt-auto` keeps the footer on the card's bottom edge.
          <CardFooter className="mt-auto grid grid-cols-1 gap-2">
            {action === 'start' && (
              <Button
                className="min-h-11 w-full whitespace-normal"
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
            {canGiveUp && (
              <TaskGiveUpControl
                taskId={task.id}
                assignmentMode={task.assignmentMode}
                onGaveUp={() => {
                  // The list shows the receipt when it holds the card; the
                  // sheet's card keeps it, since the control leaves with the
                  // Executor's actions (Audit D-3).
                  const receipt = gaveUpReceipt(task.assignmentMode);
                  if (onGaveUp) onGaveUp(task.id, receipt);
                  else setNotice(receipt);
                }}
              />
            )}
          </CardFooter>
        )}
      </Card>
    </article>
  );
}
