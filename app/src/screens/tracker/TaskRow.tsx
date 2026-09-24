import { useId, type CSSProperties } from 'react';
import { CalendarClock } from 'lucide-react';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { formatPoints } from '../../lib/format';
import type { TaskPresentation } from './task-presentation';
import { TaskGroupChip, TaskStatusBadges } from './TaskCard';

/**
 * The #685 card in dense row form (ruling R10, #687) for De gestionat and
 * Toate: stripe, title (opens the details sheet), Group chip, status with its
 * overdue/feedback/late badges, deadline, Executor and points. One line when
 * there is room; every piece wraps rather than scrolling sideways.
 */
export function TaskRow({
  task,
  onOpenTask,
}: {
  task: TaskPresentation;
  onOpenTask?: (id: number) => void;
}) {
  const titleId = useId();
  const stripe = task.origin.color ?? 'var(--ink-400)';
  return (
    <article
      aria-labelledby={titleId}
      data-slot="task-row"
      data-overdue={task.overdue || undefined}
      className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card py-2 pr-3 pl-4 data-overdue:border-destructive/40"
      style={{ '--task-stripe': stripe } as CSSProperties}
    >
      <span
        aria-hidden="true"
        data-slot="task-stripe"
        className="absolute inset-y-0 left-0 w-1.5 bg-(--task-stripe)"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          id={titleId}
          className="min-w-0 basis-full text-sm leading-snug font-semibold wrap-anywhere sm:basis-0 sm:grow"
        >
          {onOpenTask ? (
            <Button
              variant="link"
              className="h-auto min-h-11 min-w-11 justify-start p-0 text-left text-sm leading-snug font-semibold whitespace-normal wrap-anywhere text-foreground"
              onClick={() => onOpenTask(task.id)}
            >
              {task.title}
            </Button>
          ) : (
            task.title
          )}
        </h2>
        <TaskGroupChip task={task} />
        <TaskStatusBadges task={task} />
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <CalendarClock
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">Termen: </span>
          {task.deadline ? (
            <time
              dateTime={task.deadline}
              className={
                task.overdue ? 'font-semibold text-destructive' : undefined
              }
            >
              {task.deadlineLabel}
            </time>
          ) : (
            <span className="text-muted-foreground">{task.deadlineLabel}</span>
          )}
        </p>
        {task.kind === 'task' && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Executor:</span>
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
        {task.points !== null && (
          <p className="text-sm font-medium tabular-nums">
            {formatPoints(task.points)} puncte
          </p>
        )}
      </div>
    </article>
  );
}
