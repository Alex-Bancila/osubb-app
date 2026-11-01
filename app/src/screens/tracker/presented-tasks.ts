import { useMemo, useState } from 'react';
import {
  isTerminalTask,
  toTaskPresentation,
  type TaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';

/** A row of a Tracker list beside what its `TaskRow` shows. */
export type PresentedTask<Row extends TaskPresentationRow> = {
  row: Row;
  task: TaskPresentation;
};

/**
 * Each row's presentation, kept while it would say the same (#1147), so a
 * memoised `TaskRow` given it does not render again:
 *
 * - a row object read again is presented again;
 * - a finished row is never presented again for the clock — its deadline
 *   is history, and nothing it shows moves with the time;
 * - an open row is, and keeps its earlier presentation while its deadline
 *   reads the same and stays on the same side of now.
 *
 * The cache is the list's own and holds a row only as long as the read does.
 */
export function usePresentedTasks<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  now: Date,
): PresentedTask<Row>[] {
  // One cache for the list's life, made once.
  const [kept] = useState(
    () => new WeakMap<TaskPresentationRow, TaskPresentation>(),
  );
  return useMemo(
    () =>
      rows.map((row) => {
        const before = kept.get(row);
        if (before && isTerminalTask(row.status)) return { row, task: before };
        const fresh = toTaskPresentation(row, now);
        if (
          before &&
          before.deadlineLabel === fresh.deadlineLabel &&
          before.overdue === fresh.overdue
        )
          return { row, task: before };
        kept.set(row, fresh);
        return { row, task: fresh };
      }),
    [kept, rows, now],
  );
}
