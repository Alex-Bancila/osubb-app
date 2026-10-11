import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import {
  FilterSearch,
  type FilterChip,
} from '../../components/work-filter/FilterToolbar';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { workFilterChoices, type WorkItem } from '../../lib/work-filter';
import { useWorkFilterOptions } from '../../queries/work-filter-options';
import type { TitleSearch } from './use-title-search';

/** The hint when a Group level shows, and when only the dates do (F-8). */
export const TRACKER_FILTER_HINT =
  'Grupul include toate subgrupurile sale; perioada se aplică termenului taskului.';
export const TRACKER_FILTER_DATES_HINT =
  'Perioada se aplică termenului taskului.';

/**
 * A Tracker list's stack: the toolbar, then what the list shows. The same on
 * every tab, loading or loaded, so the toolbar never moves.
 */
export const trackerListClass = 'flex min-w-0 flex-col gap-4';

/**
 * The toolbar above every Tracker list (#903), the same row on each: the
 * title search, which fills it, then the Grupuri preferate star and
 * **Filtrează** as an icon button. The Work Filter (#678) keeps its state in
 * the URL and the search is the page's one `TitleSearch`, so both carry from
 * tab to tab and the list narrows itself by reading them. `rows` are the Tasks
 * the list can show: Rule W (#845) offers only their Groups and Campaigns, and
 * the hint speaks of Groups only when a Group level shows.
 */
export function TrackerWorkFilter({
  rows,
  search,
  count,
  disabled = false,
  preferredNotice,
  fields,
  extraChips,
}: {
  rows: readonly WorkItem[];
  search: TitleSearch;
  /** How many Tasks the list shows now, named in the search's placeholder. */
  count?: number;
  /** The list is loading or failed: the search holds its place, disabled. */
  disabled?: boolean;
  /** `false` where Grupuri preferate never narrows the list (Taskurile mele). */
  preferredNotice?: boolean;
  /** More cells for the sheet (De gestionat's Stare, Ordonează). */
  fields?: (id: string) => ReactNode;
  /** Chips for those cells when set. */
  extraChips?: readonly FilterChip[];
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
      extraChips={extraChips}
      preferredNotice={preferredNotice}
      search={
        <FilterSearch
          label="Caută după titlu"
          // The result count lives here, not on a row of its own.
          placeholder={
            count ? `Caută în ${formatTaskCount(count)}` : 'Caută după titlu'
          }
          // The field takes the row's whole width at every size, and the
          // row holds the star and Filtrează beside it down to 320 px.
          className="basis-40 sm:max-w-none"
          disabled={disabled}
          value={search.text}
          onChange={(event) => search.setText(event.target.value)}
        />
      }
    />
  );
}

/** The way out of a search that matches nothing, under a list's empty state. */
export function ClearSearchButton({ search }: { search: TitleSearch }) {
  return (
    <Button variant="outline" onClick={search.clear}>
      Șterge căutarea
    </Button>
  );
}

/** Shown instead of a list while the date range is inverted (#678). */
export const RANGE_FIRST =
  'Corectează perioada din filtre ca să vezi taskurile.';
