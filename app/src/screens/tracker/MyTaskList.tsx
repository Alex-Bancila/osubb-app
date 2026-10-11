import type { ReactNode } from 'react';
import { EmptyState } from '../../components/layout';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import type { OnGaveUp } from './give-up-receipt';
import type { TaskPresentationRow } from './task-presentation';
import { TaskRowList } from './TaskRowList';
import {
  ClearSearchButton,
  RANGE_FIRST,
  trackerListClass,
  TrackerWorkFilter,
} from './TrackerWorkFilter';
import { matchesTitle, type TitleSearch } from './use-title-search';

/**
 * Taskurile mele: under the Tracker's toolbar, the member's own Tasks as
 * rows, narrowed by the title search and the Work Filter (Rule W over their
 * own Tasks). Grupuri preferate never narrows it (R43), so the toolbar has no
 * star here. `header` (the Personal Score, a receipt) sits between the toolbar
 * and the rows.
 *
 * The link wins: the Task a `?task=` link names (`linkedId`) stays in the
 * list whatever the search and the filters say, so the row the link lands on
 * is always there to scroll to.
 */
export function MyTaskList({
  rows,
  now,
  search,
  header,
  onOpenTask,
  linkedId = null,
  highlightedId = null,
  onGaveUp,
}: {
  rows: readonly TaskPresentationRow[];
  now: Date;
  search: TitleSearch;
  header?: ReactNode;
  onOpenTask: (id: number) => void;
  linkedId?: number | null;
  highlightedId?: number | null;
  onGaveUp?: OnGaveUp;
}) {
  const { params } = useWorkFilter();
  const shown = rows.filter(
    (row) =>
      row.id === linkedId ||
      (params !== null &&
        matchesWorkFilter(row, params) &&
        matchesTitle(row.title, search.needle)),
  );
  return (
    <div className={trackerListClass}>
      <TrackerWorkFilter
        rows={rows}
        search={search}
        count={params ? shown.length : undefined}
        preferredNotice={false}
      />
      {header}
      {!params && <p>{RANGE_FIRST}</p>}
      {shown.length ? (
        <TaskRowList
          rows={shown}
          now={now}
          onOpenTask={onOpenTask}
          highlightedId={highlightedId}
          onGaveUp={onGaveUp}
        />
      ) : (
        params && (
          <EmptyState
            bare
            action={
              rows.length > 0 && search.needle ? (
                <ClearSearchButton search={search} />
              ) : null
            }
          >
            {!rows.length
              ? 'Nu ai niciun task atribuit încă.'
              : search.needle
                ? 'Niciun task nu corespunde căutării.'
                : 'Niciun task nu corespunde filtrelor.'}
          </EmptyState>
        )
      )}
    </div>
  );
}
