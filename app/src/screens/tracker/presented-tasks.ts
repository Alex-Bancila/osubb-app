import { useMemo, useState } from 'react';
import { bucharestDayKey } from '../../lib/calendar-time';
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
 * - a finished row is presented again for the clock only when the year
 *   turns in Romania: its deadline is history, and only the year it shows
 *   (or drops, for this year's dates) moves with the time;
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
    () =>
      new WeakMap<
        TaskPresentationRow,
        { task: TaskPresentation; year: string }
      >(),
  );
  return useMemo(() => {
    const year = bucharestDayKey(now)?.slice(0, 4) ?? '';
    return rows.map((row) => {
      const before = kept.get(row);
      if (before && before.year === year && isTerminalTask(row.status))
        return { row, task: before.task };
      const fresh = toTaskPresentation(row, now);
      const task =
        before &&
        before.task.deadlineLabel === fresh.deadlineLabel &&
        before.task.overdue === fresh.overdue
          ? before.task
          : fresh;
      kept.set(row, { task, year });
      return { row, task };
    });
  }, [kept, rows, now]);
}
