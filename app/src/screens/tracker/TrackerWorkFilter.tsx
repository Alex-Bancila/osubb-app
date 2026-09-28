import type { ReactNode } from 'react';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import type { WorkItem } from '../../lib/work-filter';
import { useWorkFilterOptions } from '../../queries/work-filter-options';

/**
 * The Work Filter (#678) above a Tracker list. Its state is in the URL, so
 * the list reads the same `useWorkFilter()` and narrows itself. `rows` are
 * the Tasks the list can show: Rule W (#845) offers only their Groups and
 * Campaigns.
 */
export function TrackerWorkFilter({
  hint,
  rows,
  fields,
  fieldsActive,
}: {
  hint: string;
  rows: readonly WorkItem[];
  /** More cells for the same grid (De gestionat's Stare, Caută, Ordonează). */
  fields?: (id: string) => ReactNode;
  fieldsActive?: number;
}) {
  const options = useWorkFilterOptions();
  return (
    <WorkFilter
      label="Filtre taskuri"
      status={{
        pending: options.isPending,
        failed: options.isError,
        error: options.error,
        onRetry: () => void options.refetch(),
      }}
      groups={options.data?.groups ?? []}
      campaigns={options.data?.campaigns ?? []}
      work={rows}
      hint={hint}
      fields={fields}
      fieldsActive={fieldsActive}
    />
  );
}

/** Shown instead of a list while the date range is inverted (#678). */
export const RANGE_FIRST =
  'Corectează perioada din filtre ca să vezi taskurile.';
