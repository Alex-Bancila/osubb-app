import { useMemo } from 'react';
import type { WorkFilterWorkRead } from '../../components/work-filter/WorkFilter';
import {
  useFinishedTasks,
  type FinishedFilters,
  type FinishedListName,
  type FinishedTasks,
} from '../../queries/task-lists';

/**
 * The finished part of a Tracker list (#1053, rulings R54 and R55): its
 * finished Tasks, read from the server 50 at a time under `filters`, asked
 * as soon as the list is drawn — beside its open read, not once that lands.
 * A Task that has just finished can still be in the open read for a moment:
 * `rows` leaves out every Task `open` holds, so none is drawn twice.
 * `FinishedTasksPanel` draws it.
 */
export function useFinishedPart(
  list: FinishedListName,
  filters: FinishedFilters | null,
  open: readonly { id: number }[],
): FinishedTasks {
  const finished = useFinishedTasks(list, filters, true);
  const rows = useMemo(() => {
    const openIds = new Set(open.map((row) => row.id));
    return finished.rows.filter((row) => !openIds.has(row.id));
  }, [finished.rows, open]);
  return { ...finished, rows };
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
