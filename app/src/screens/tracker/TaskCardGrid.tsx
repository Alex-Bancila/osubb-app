import type { ComponentProps } from 'react';
import { PageGrid } from '../../components/layout';
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

/**
 * Task cards on the collection grid (ruling R27, decision D4): one column on a
 * phone, two from `md`, three from `xl`, every card in a row the same height.
 * The shell does the scrolling.
 */
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
    <PageGrid as="ul" columns="collection" data-grid="task-cards">
      {rows.map((row) => (
        <li key={row.id} data-slot="task-card-row">
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
    </PageGrid>
  );
}
