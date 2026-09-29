import type { ReactNode } from 'react';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useWorkFilter } from '../../lib/use-work-filter';
import { workFilterChoices, type WorkItem } from '../../lib/work-filter';
import { useWorkFilterOptions } from '../../queries/work-filter-options';

/** The hint when a Group level shows, and when only the dates do (F-8). */
export const TRACKER_FILTER_HINT =
  'Grupul include toate subgrupurile sale; perioada se aplică termenului taskului.';
export const TRACKER_FILTER_DATES_HINT =
  'Perioada se aplică termenului taskului.';

/**
 * The Work Filter (#678) above a Tracker list. Its state is in the URL, so
 * the list reads the same `useWorkFilter()` and narrows itself. `rows` are
 * the Tasks the list can show: Rule W (#845) offers only their Groups and
 * Campaigns, and the hint speaks of Groups only when a Group level shows.
 */
export function TrackerWorkFilter({
  rows,
  fields,
  fieldsActive,
}: {
  rows: readonly WorkItem[];
  /** More cells for the same grid (De gestionat's Stare, Caută, Ordonează). */
  fields?: (id: string) => ReactNode;
  fieldsActive?: number;
}) {
  const options = useWorkFilterOptions();
  const { value } = useWorkFilter();
  const groups = options.data?.groups ?? [];
  const campaigns = options.data?.campaigns ?? [];
  const choices = workFilterChoices(groups, campaigns, value, { work: rows });
  const groupShown = choices.showRoot || choices.showSub;
  return (
    <WorkFilter
      label="Filtre taskuri"
      status={{
        pending: options.isPending,
        failed: options.isError,
        error: options.error,
        onRetry: () => void options.refetch(),
      }}
      groups={groups}
      campaigns={campaigns}
      work={rows}
      hint={groupShown ? TRACKER_FILTER_HINT : TRACKER_FILTER_DATES_HINT}
      fields={fields}
      fieldsActive={fieldsActive}
    />
  );
}

/** Shown instead of a list while the date range is inverted (#678). */
export const RANGE_FIRST =
  'Corectează perioada din filtre ca să vezi taskurile.';
