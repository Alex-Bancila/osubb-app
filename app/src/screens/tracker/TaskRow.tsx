import { useId, type CSSProperties } from 'react';
import { Clock, UserRound } from 'lucide-react';
import { ListRow } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { formatPoints } from '../../lib/format';
import { isTerminalTask, type TaskPresentation } from './task-presentation';
import { TaskGroupChip, TaskStatusBadges } from './TaskCard';

/**
 * One Task in De gestionat and Toate (ruling R10, #687), on `ListRow`
 * (#846, layout T1/X14): the Group stripe, the title across the row's whole
 * width — so it wraps where its words do, never into three short lines beside
 * a value column — and one meta line under it (the row's footer): Group chip
 * · status, then the short deadline · the Executor by avatar and name, and
 * the points at the line's end. Each unit wraps whole.
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
              {/* A finished Task names who finished it (#861), or nothing:
                  a cancelled Task never reads "Neatribuit". */}
              {task.kind === 'task' &&
                !(isTerminalTask(task.status) && task.executor === null) && (
                  <p className="m-0 flex min-w-0 items-center gap-1.5">
                    <span className="sr-only">Executor:</span>
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
            {task.points !== null && (
              <p
                data-slot="task-row-points"
                className="m-0 ml-auto flex shrink-0 items-baseline gap-1 tabular-nums"
              >
                <span className="text-base font-bold">
                  {formatPoints(task.points)}
                </span>
                <span className="text-xs text-muted-foreground">puncte</span>
              </p>
            )}
          </div>
        }
        className="items-start gap-x-4 gap-y-2 py-3 pr-4 pl-5"
      >
        <h2
          id={titleId}
          data-slot="task-row-title"
          className="m-0 text-base leading-snug font-semibold wrap-break-word"
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
