import { useCallback, type ComponentProps } from 'react';
import { AnimatedList } from '../../components/layout';
import { useAuth } from '../../lib/auth';
import {
  useTaskProgress,
  type TaskProgressInput,
} from '../../queries/task-progress';
import type { OnGaveUp } from './give-up-receipt';
import { usePresentedTasks } from './presented-tasks';
import type { TaskPresentationRow } from './task-presentation';
import { TaskRow } from './TaskRow';

type RowOptions = Pick<
  ComponentProps<typeof TaskRow>,
  'allowInterest' | 'joinable' | 'queue' | 'titleLevel'
>;

/**
 * A Member's own Tasks or the open Opportunities as one column of detailed
 * rows, the same list De gestionat and Toate draw (`task-row-list`). The
 * Executor's actions go through here, and the row a `?task=` link names is
 * anchored and highlighted. The shell does the scrolling. A row that leaves —
 * given up, taken by someone else, filtered out — closes instead of snapping.
 * A row renders again only when what it shows changes (#1147): its
 * presentation is kept by row and clock, and its callbacks stay the same.
 */
export function TaskRowList<Row extends TaskPresentationRow>({
  rows,
  now,
  onOpenTask,
  highlightedId = null,
  row: options,
  onGaveUp,
}: {
  rows: readonly Row[];
  now: Date;
  onOpenTask: (id: number) => void;
  highlightedId?: number | null;
  /** Per-row options: interest controls, heading level. */
  row?: (row: Row) => RowOptions;
  /** Taskurile mele: the give-up receipt outlives the row (Audit D-3). */
  onGaveUp?: OnGaveUp;
}) {
  const progress = useTaskProgress();
  const { session } = useAuth();
  const presented = usePresentedTasks(rows, now);
  const mutateAsync = progress.mutateAsync;
  const onProgress = useCallback(
    (input: TaskProgressInput) => mutateAsync(input),
    [mutateAsync],
  );
  return (
    <AnimatedList
      data-slot="task-row-list"
      className="gap-2"
      items={presented}
      getKey={({ row }) => row.id}
    >
      {({ row, task }) => (
        <TaskRow
          {...options?.(row)}
          detailed
          anchor
          task={task}
          onOpenTask={onOpenTask}
          memberId={session?.user.id}
          pending={progress.isPending && progress.variables?.taskId === row.id}
          onProgress={onProgress}
          highlighted={row.id === highlightedId}
          onGaveUp={onGaveUp}
        />
      )}
    </AnimatedList>
  );
}
