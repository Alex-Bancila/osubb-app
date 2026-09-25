import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useWorkFilterOptions } from '../../queries/work-filter-options';

/**
 * The Work Filter (#678) above a Tracker list. Its state is in the URL, so
 * the list reads the same `useWorkFilter()` and narrows itself.
 */
export function TrackerWorkFilter({ hint }: { hint: string }) {
  const options = useWorkFilterOptions();
  return (
    <section
      aria-label="Filtre taskuri"
      className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4"
    >
      {options.isPending ? (
        <p role="status">Se încarcă filtrele…</p>
      ) : options.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca filtrele.</p>
          <Button
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => options.refetch()}
          >
            Reîncarcă filtrele
          </Button>
        </div>
      ) : (
        <WorkFilter
          groups={options.data.groups}
          campaigns={options.data.campaigns}
          hint={hint}
        />
      )}
    </section>
  );
}

/** Shown instead of a list while the date range is inverted (#678). */
export const RANGE_FIRST =
  'Corectează perioada din filtre ca să vezi taskurile.';
