import type { ComponentProps } from 'react';
import { useAuth } from '../../lib/auth';
import { useTaskProgress } from '../../queries/task-progress';
import { TaskCard } from './TaskCard';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';

type CardOptions = Pick<
  ComponentProps<typeof TaskCard>,
  'allowInterest' | 'joinable' | 'titleLevel'
>;

/** One Task card per row, one column wide; the shell does the scrolling. */
export function TaskCardGrid<Row extends TaskPresentationRow>({
  rows,
  now,
  onOpenTask,
  highlightedId = null,
  card,
}: {
  rows: readonly Row[];
  now: Date;
  onOpenTask: (id: number) => void;
  highlightedId?: number | null;
  /** Per-row card options: interest controls, heading level. */
  card?: (row: Row) => CardOptions;
}) {
  const progress = useTaskProgress();
  const { session } = useAuth();
  return (
    <ul
      data-slot="task-card-grid"
      className="grid min-w-0 grid-cols-1 items-stretch gap-4 p-0"
    >
      {rows.map((row) => (
        <li key={row.id} data-slot="task-card-row" className="h-full min-w-0">
          <TaskCard
            {...card?.(row)}
            task={toTaskPresentation(row, now)}
            onOpenTask={onOpenTask}
            memberId={session?.user.id}
            pending={
              progress.isPending && progress.variables?.taskId === row.id
            }
            onProgress={(input) => progress.mutateAsync(input)}
            highlighted={row.id === highlightedId}
          />
        </li>
      ))}
    </ul>
  );
}
