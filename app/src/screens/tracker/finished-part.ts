import { useMemo, useState } from 'react';
import type { WorkFilterWorkRead } from '../../components/work-filter/WorkFilter';
import {
  FINISHED_PAGE,
  useFinishedTasks,
  type FinishedFilters,
  type FinishedListName,
  type FinishedTasks,
} from '../../queries/task-lists';

/**
 * How many finished rows the page holds at once (#1147): four pages. Past
 * it the list moves as a window over what is read — a page on at the end,
 * a page back at the top — so a BC member scrolling Toate through the
 * Legacy Import never holds thousands of rows in the page.
 */
export const FINISHED_WINDOW = 200;

/** A finished part as `FinishedTasksPanel` draws it: its window of rows. */
export type FinishedPart = FinishedTasks & {
  /** Rows read before the window: **Arată taskurile anterioare** shows them. */
  earlier: number;
  showEarlier: () => void;
  /** The window is full: the next rows come from the button alone. */
  full: boolean;
};

/**
 * The finished part of a Tracker list (#1053, rulings R54 and R55): its
 * finished Tasks, read from the server 50 at a time under `filters`, asked
 * as soon as the list is drawn — beside its open read, not once that lands.
 * A Task that has just finished can still be in the open read for a moment:
 * `rows` leaves out every Task `open` holds, so none is drawn twice.
 * Of those, `rows` is the window the page holds (`FINISHED_WINDOW`): up to
 * it the end of the list reads the next page as before; past it
 * **Încarcă mai multe** moves the window a page on — reading that page
 * first when it is not read yet — and drops the first page from the page.
 * Other filters open the window on their first rows again.
 * `FinishedTasksPanel` draws it.
 */
export function useFinishedPart(
  list: FinishedListName,
  filters: FinishedFilters | null,
  open: readonly { id: number }[],
): FinishedPart {
  const finished = useFinishedTasks(list, filters, true);
  const all = useMemo(() => {
    const openIds = new Set(open.map((row) => row.id));
    return finished.rows.filter((row) => !openIds.has(row.id));
  }, [finished.rows, open]);

  const [windowEnd, setWindowEnd] = useState(FINISHED_WINDOW);
  const shownList = JSON.stringify([list, filters]);
  const [windowList, setWindowList] = useState(shownList);
  if (windowList !== shownList) {
    setWindowList(shownList);
    setWindowEnd(FINISHED_WINDOW);
  }
  // Never past what is read (a page on its way waits for it), never short
  // of a full window while one is read.
  const end = Math.min(windowEnd, Math.max(all.length, FINISHED_WINDOW));
  const start = Math.max(0, end - FINISHED_WINDOW);
  const rows = useMemo(() => all.slice(start, end), [all, start, end]);
  const later = end < all.length;

  return {
    ...finished,
    rows,
    hasMore: later || finished.hasMore,
    loadMore: () => {
      if (all.length <= end) finished.loadMore();
      if (all.length >= end) setWindowEnd(end + FINISHED_PAGE);
    },
    earlier: start,
    showEarlier: () =>
      setWindowEnd(Math.max(FINISHED_WINDOW, end - FINISHED_PAGE)),
    full: rows.length >= FINISHED_WINDOW,
  };
}

/**
 * How the Work Filter's sheet stands on a list's summary
 * (`task_list_summary`) while it has no answer: it holds the choices' place,
 * or offers a retry, never the open rows' choices as if they were all. A
 * retry is pending again with no error: having failed before
 * (`errorUpdateCount`), it keeps the retry, saying it retries. A later read
 * that fails keeps what was read (`undefined`: the sheet offers it).
 */
export function summaryWorkRead(summary: {
  data: unknown;
  isError: boolean;
  error: Error | null;
  errorUpdateCount?: number;
  refetch: () => unknown;
}): WorkFilterWorkRead | undefined {
  if (summary.data !== undefined) return undefined;
  if (summary.isError || (summary.errorUpdateCount ?? 0) > 0)
    return {
      status: 'failed',
      error: summary.error,
      onRetry: () => void summary.refetch(),
      retrying: !summary.isError,
    };
  return { status: 'loading' };
}
