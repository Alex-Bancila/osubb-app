import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { DifficultyMark } from '../../components/tasks/DifficultyMark';
import { Badge } from '../../components/ui/badge';
import { formatPoints } from '../../lib/format';
import { cn } from '../../lib/utils';
import type { TaskPresentation } from './task-presentation';

/*
 * The parts a Task shows the same way wherever it is drawn — the row
 * (`TaskRow`) and the details sheet: its Group chip, its status badges and
 * its Evaluation.
 */

const chipClass =
  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground';

/**
 * The chip naming the Task's Group, its dot in the `--task-stripe` colour the
 * surrounding row or sheet sets. Colour is never the only carrier: the chip
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
