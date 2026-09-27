import { ListFilter } from 'lucide-react';
import { Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useWorkFilterOptions } from '../../queries/work-filter-options';

/**
 * The Work Filter (#678) above a Tracker list. Its state is in the URL, so
 * the list reads the same `useWorkFilter()` and narrows itself.
 */
export function TrackerWorkFilter({ hint }: { hint: string }) {
  const options = useWorkFilterOptions();
  return (
    <Panel eyebrow="Filtre" icon={ListFilter} aria-label="Filtre taskuri">
      {options.isPending ? (
        <Loading label="Se încarcă filtrele…" />
      ) : options.isError ? (
        <ErrorState
          error={options.error}
          text="Nu am putut încărca filtrele."
          retryLabel="Reîncarcă filtrele"
          onRetry={() => void options.refetch()}
        />
      ) : (
        <WorkFilter
          groups={options.data.groups}
          campaigns={options.data.campaigns}
          hint={hint}
        />
      )}
    </Panel>
  );
}

/** Shown instead of a list while the date range is inverted (#678). */
export const RANGE_FIRST =
  'Corectează perioada din filtre ca să vezi taskurile.';
