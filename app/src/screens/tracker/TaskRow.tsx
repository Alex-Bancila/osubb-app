import { useId, type CSSProperties } from 'react';
import { CalendarClock } from 'lucide-react';
import { ListRow } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { formatPoints } from '../../lib/format';
import { isTerminalTask, type TaskPresentation } from './task-presentation';
import { TaskGroupChip, TaskStatusBadges } from './TaskCard';

/**
 * One Task in De gestionat and Toate (ruling R10, #687), on `ListRow`
 * (#846, layout T1/X14): the Group stripe, the title with the points as the
 * row's value, and one meta line under both (the row's footer, so it has the
 * full width at 375 px) — Group chip · status, then deadline · Executor, each
 * pair wrapping as a unit. The title wraps by word and never
 * narrows below 12 rem, so every row of a list has the same shape.
 *
 * The whole row opens the details sheet: the title is the button, and its
 * hit area is stretched over the row. The Executor's name stays its own
 * button (their Member Card) above that area.
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
      className="relative min-w-0 overflow-hidden rounded-md border border-border bg-card transition-colors data-overdue:border-destructive/40 has-[[data-slot=task-row-open]:hover]:bg-muted/40 has-[[data-slot=task-row-open]:focus-visible]:outline-2 has-[[data-slot=task-row-open]:focus-visible]:outline-offset-2 has-[[data-slot=task-row-open]:focus-visible]:outline-ring has-[[data-slot=task-row-open]:focus-visible]:outline-solid"
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
          <div
            data-slot="task-row-meta"
            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          >
            {/* Two units — where the Task stands, then when and who — so a
                  row breaks between them, never inside one. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <TaskGroupChip task={task} />
              <TaskStatusBadges task={task} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <p className="m-0 flex min-w-0 items-center gap-1.5">
                <CalendarClock
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="sr-only">Termen: </span>
                {task.deadline ? (
                  <time
                    dateTime={task.deadline}
                    className={
                      task.overdue
                        ? 'font-semibold text-destructive'
                        : undefined
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
              {/* A finished Task names who finished it (#861), or nothing:
                  a cancelled Task never reads "Neatribuit". */}
              {task.kind === 'task' &&
                !(isTerminalTask(task.status) && task.executor === null) && (
                  <p className="m-0 flex min-w-0 items-center gap-1.5">
                    <span className="text-muted-foreground">Executor:</span>
                    {task.executor?.name ? (
                      <MemberName
                        size="sm"
                        className="relative z-10"
                        memberId={task.executor.memberId}
                        nickname={task.executor.nickname}
                        fullName={task.executor.name}
                      />
                    ) : (
                      <span className="min-w-0">
                        {task.executor ? 'Nume indisponibil' : 'Neatribuit'}
                      </span>
                    )}
                  </p>
                )}
            </div>
          </div>
        }
        className="items-start gap-x-4 gap-y-2 py-3 pr-4 pl-5"
        value={
          task.points !== null ? (
            <p
              data-slot="task-row-points"
              className="m-0 flex items-baseline justify-end gap-1"
            >
              <span className="text-base font-bold">
                {formatPoints(task.points)}
              </span>
              <span className="text-xs text-muted-foreground">puncte</span>
            </p>
          ) : undefined
        }
      >
        <h2
          id={titleId}
          data-slot="task-row-title"
          className="m-0 min-w-48 text-base leading-snug font-semibold text-balance wrap-break-word"
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
        </h2>
      </ListRow>
    </article>
  );
}
