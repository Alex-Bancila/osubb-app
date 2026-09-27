import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { reasonCopy } from './command-reasons';
import {
  dateRangeReason,
  hiddenWorkFilter,
  isWorkFilterActive,
  parseWorkFilter,
  serializeWorkFilter,
  setWorkFilterLevel,
  visibleWorkFilter,
  workFilterParams,
  type WorkFilterLevel,
  type WorkFilterLevels,
  type WorkFilterParams,
  type WorkFilterValue,
} from './work-filter';

export type WorkFilterState = {
  /** The parsed filter; an unset level is absent. */
  value: WorkFilterValue;
  /**
   * The RPC arguments (`p_group_id`, `p_campaign_id`, `p_from`, `p_to`) with
   * unset levels left out, or `null` while the date range is inverted — pass
   * `skipToken` then, so nothing reaches the server.
   */
  params: WorkFilterParams | null;
  /** The Romanian message for an inverted range, shown under **Până la**. */
  rangeError: string | undefined;
  /** Whether any level is set. */
  active: boolean;
  /** Change one level; the levels that depended on it are cleared. */
  set: <L extends WorkFilterLevel>(
    level: L,
    next: WorkFilterValue[L] | undefined,
  ) => void;
  /** Remove every level the page shows (hidden levels and the page's own query keys stay). */
  clear: () => void;
};

/**
 * The Work Filter's state, read from and written to the URL query string
 * (`grup`, `subgrup`, `campanie`, `de_la`, `pana_la`). Every write replaces
 * the history entry, so Back leaves the page rather than stepping through
 * each filter change. A page is a one-line consumer:
 *
 *     const { params } = useWorkFilter();
 *     useQuery({ queryFn: params ? () => read(params) : skipToken, … });
 *
 * A page that hides a level passes the same `levels` it gives `<WorkFilter>`,
 * so a hidden key in a shared URL is neither sent nor counted as active.
 */
export function useWorkFilter(levels: WorkFilterLevels = {}): WorkFilterState {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.toString();
  const group = levels.group ?? true;
  const campaign = levels.campaign ?? true;
  const dates = levels.dates ?? true;
  const value = useMemo(
    () =>
      visibleWorkFilter(parseWorkFilter(new URLSearchParams(query)), {
        group,
        campaign,
        dates,
      }),
    [query, group, campaign, dates],
  );

  const set = useCallback(
    <L extends WorkFilterLevel>(level: L, next: WorkFilterValue[L]) =>
      setSearchParams(
        (current) =>
          serializeWorkFilter(
            setWorkFilterLevel(parseWorkFilter(current), level, next),
            current,
          ),
        { replace: true },
      ),
    [setSearchParams],
  );

  // Clearing removes what the page shows; a level it hides (the Group in
  // the Cupa view) stays in the URL for the view that shows it.
  const clear = useCallback(
    () =>
      setSearchParams(
        (current) =>
          serializeWorkFilter(
            hiddenWorkFilter(parseWorkFilter(current), {
              group,
              campaign,
              dates,
            }),
            current,
          ),
        { replace: true },
      ),
    [setSearchParams, group, campaign, dates],
  );

  return useMemo(() => {
    const params = workFilterParams(value);
    return {
      value,
      params,
      rangeError: reasonCopy(dateRangeReason(value)),
      active: isWorkFilterActive(value),
      set,
      clear,
    };
  }, [value, set, clear]);
}
