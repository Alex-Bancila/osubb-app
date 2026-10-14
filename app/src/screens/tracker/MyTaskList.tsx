import { useMemo, type ReactNode } from 'react';
import { EmptyState } from '../../components/layout';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import {
  summaryWork,
  useTaskListSummary,
  type ListRead,
} from '../../queries/task-lists';
import { summaryWorkRead, useFinishedPart } from './finished-part';
import { FinishedTasksPanel } from './FinishedTasksPanel';
import type { OnGaveUp } from './give-up-receipt';
import { finishedListFilters } from './manager-task-list';
import type { TaskPresentationRow } from './task-presentation';
import { TaskQueryStates } from './TaskQueryStates';
import { TaskRowList } from './TaskRowList';
import {
  ClearSearchButton,
  RANGE_FIRST,
  trackerListClass,
  TrackerWorkFilter,
} from './TrackerWorkFilter';
import { matchesTitle, type TitleSearch } from './use-title-search';

const NO_ROWS: readonly TaskPresentationRow[] = [];

/** A finished row's title sits under **Taskuri încheiate**. */
const FINISHED_ROW = () => ({ titleLevel: 3 as const });

/**
 * Taskurile mele: under the Tracker's toolbar, the member's own Tasks as
 * rows, narrowed by the title search and the Work Filter. Grupuri preferate
 * never narrows it (R43), so the toolbar has no star here, and it has no
 * Stare nor order. `header` (the Personal Score, a receipt) sits between the
 * toolbar and the rows, loading or loaded.
 *
 * The list has two parts (ruling R55, as De gestionat's R54). `open` reads
 * its open Tasks whole: the page narrows them. The finished Tasks follow
 * under **Taskuri încheiate**, newest first, read from the server 50 at a
 * time under the same search and Work Filter — the next page when the end
 * of the list comes into view, or from **Încarcă mai multe**. The Work
 * Filter offers what both parts hold (Rule W): the open rows, and the
 * server's summary of the list. Both are asked as soon as the list is
 * drawn, beside the open read.
 *
 * The link wins: the open Task a `?task=` link names (`linkedId`) stays in
 * the list whatever the search and the filters say, so the row the link
 * lands on is always there to scroll to.
 */
export function MyTaskList({
  open,
  now,
  search,
  header,
  onOpenTask,
  linkedId = null,
  highlightedId = null,
  onGaveUp,
}: {
  /** The read of the Member's open Tasks (`useMyTasks`). */
  open: ListRead<TaskPresentationRow>;
  now: Date;
  search: TitleSearch;
  header?: ReactNode;
  onOpenTask: (id: number) => void;
  linkedId?: number | null;
  highlightedId?: number | null;
  onGaveUp?: OnGaveUp;
}) {
  const rows = open.data ?? NO_ROWS;
  const { params, active } = useWorkFilter();
  const { needle } = search;

  // What the list holds, open and finished, counted: Rule W's choices.
  const summary = useTaskListSummary('mine', true);
  const work = useMemo(
    () => [...rows, ...summaryWork(summary.data ?? [])],
    [rows, summary.data],
  );
  const summaryRead = summaryWorkRead(summary);

  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.id === linkedId ||
          (params !== null &&
            matchesWorkFilter(row, params) &&
            matchesTitle(row.title, needle)),
      ),
    [rows, linkedId, params, needle],
  );

  // The finished part's read: the same narrowing, applied by the server —
  // never Grupuri preferate. Nothing is asked while the range is inverted.
  const finishedFilters = useMemo(
    () => finishedListFilters({ params, needle, preferred: false }),
    [params, needle],
  );
  const finished = useFinishedPart('mine', finishedFilters, rows);

  // How many Tasks the list shows; unknown until the finished part answers.
  const count =
    !params || finished.isPending || finished.isError
      ? undefined
      : shown.length + (finished.total ?? 0);
  const nothing = shown.length === 0 && finished.rows.length === 0;
  const settled = !finished.isPending && !finished.isError;
  // No Task at all, open or finished: the summary says so, or — unread —
  // the finished part asked with nothing narrowing it.
  const holdsNothing =
    rows.length === 0 &&
    (summary.data !== undefined
      ? summary.data.length === 0
      : !active && !needle && finished.total === 0);

  return (
    <TaskQueryStates
      query={open}
      search={search}
      preferredNotice={false}
      header={header}
    >
      {() => (
        <div className={trackerListClass}>
          <TrackerWorkFilter
            rows={work}
            rowsRead={summaryRead}
            search={search}
            count={count}
            preferredNotice={false}
          />
          {header}
          {!params && <p>{RANGE_FIRST}</p>}
          {shown.length > 0 && (
            <TaskRowList
              rows={shown}
              now={now}
              onOpenTask={onOpenTask}
              highlightedId={highlightedId}
              onGaveUp={onGaveUp}
            />
          )}
          {params && (
            <FinishedTasksPanel finished={finished}>
              <TaskRowList
                rows={finished.rows}
                now={now}
                onOpenTask={onOpenTask}
                row={FINISHED_ROW}
              />
            </FinishedTasksPanel>
          )}
          {params && nothing && settled && (
            <EmptyState
              bare
              action={
                !holdsNothing && needle ? (
                  <ClearSearchButton search={search} />
                ) : null
              }
            >
              {holdsNothing
                ? 'Nu ai niciun task atribuit încă.'
                : needle
                  ? 'Niciun task nu corespunde căutării.'
                  : 'Niciun task nu corespunde filtrelor.'}
            </EmptyState>
          )}
        </div>
      )}
    </TaskQueryStates>
  );
}
