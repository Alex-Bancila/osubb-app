import type { ReactNode } from 'react';
import { ErrorState, Loading } from '../../components/states';
import type { ListRead } from '../../queries/task-lists';
import { trackerListClass, TrackerWorkFilter } from './TrackerWorkFilter';
import type { TitleSearch } from './use-title-search';

const NO_ROWS: readonly never[] = [];

/**
 * The loading and retry states every Tracker list shares. The toolbar keeps
 * its row meanwhile, its search disabled, so nothing moves when the list
 * lands; `header` is what a list shows between the toolbar and its Tasks.
 */
export function TaskQueryStates<Row>({
  query,
  search,
  preferredNotice,
  header,
  children,
}: {
  query: ListRead<Row>;
  search: TitleSearch;
  preferredNotice?: boolean;
  header?: ReactNode;
  children: (rows: Row[]) => ReactNode;
}) {
  const { data } = query;
  if (data === undefined || query.isPending || query.isError)
    return (
      <div className={trackerListClass}>
        <TrackerWorkFilter
          rows={NO_ROWS}
          search={search}
          disabled
          preferredNotice={preferredNotice}
        />
        {header}
        {query.isError ? (
          <ErrorState
            error={query.error}
            text="Nu am putut încărca taskurile."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Loading label="Se încarcă taskurile…" />
        )}
      </div>
    );
  return children(data);
}
