import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { reasonCopy } from './command-reasons';
import {
  dateRangeReason,
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
  /** Remove every level (the page's own query keys stay). */
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
  const campaign = levels.campaign ?? true;
  const dates = levels.dates ?? true;
  const value = useMemo(
    () =>
      visibleWorkFilter(parseWorkFilter(new URLSearchParams(query)), {
        campaign,
        dates,
      }),
    [query, campaign, dates],
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

  const clear = useCallback(
    () =>
      setSearchParams((current) => serializeWorkFilter({}, current), {
        replace: true,
      }),
    [setSearchParams],
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
