import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useWorkFilter, type WorkFilterState } from '../../lib/use-work-filter';
import {
  chosenGroupId,
  isWorkFilterActive,
  placeGroup,
  serializeWorkFilter,
  setWorkFilterLevel,
  withoutGroup,
  type WorkFilterGroup,
  type WorkFilterLevel,
  type WorkFilterValue,
} from '../../lib/work-filter';

/** The Campanii levels: the two Group levels and the dates, never a Campaign. */
export const CAMPAIGNS_FILTER_LEVELS = { campaign: false } as const;

/** Where a chosen Group's Campaigns live; no Group is the bare page. */
export function campaignsPath(groupId: number | undefined) {
  return groupId === undefined
    ? '/administrare/campanii'
    : `/administrare/grupuri/${groupId}/campanii`;
}

/**
 * The Campanii Work Filter (ruling R13): **Grup principal** → **Subgrup** over
 * the Groups the caller manages, then the dates. The chosen Group lives in the
 * route (`/administrare/grupuri/:groupId/campanii`, as before), so the root and
 * Subgrup are derived from its path; the dates live in the query string like
 * every other Work Filter (`de_la`, `pana_la`). The returned state drives
 * `<WorkFilter state={…}>`, and `params` carries only `p_from`/`p_to` — the
 * report's range — or `null` while the range is inverted.
 */
export function useCampaignsFilter(
  groups: readonly WorkFilterGroup[],
): WorkFilterState & { routeGroupId: number | undefined } {
  const dates = useWorkFilter(CAMPAIGNS_FILTER_LEVELS);
  const { groupId: raw } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const routeGroupId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;

  const value = useMemo(() => {
    const next: WorkFilterValue = placeGroup(groups, routeGroupId, 'topmost');
    if (dates.value.from) next.from = dates.value.from;
    if (dates.value.to) next.to = dates.value.to;
    return next;
  }, [groups, routeGroupId, dates.value.from, dates.value.to]);

  /** Go to the chosen Group's page, keeping the dates and the page's own keys. */
  const go = useCallback(
    (next: WorkFilterValue) => {
      const params = serializeWorkFilter(
        { from: next.from, to: next.to },
        new URLSearchParams(search),
      );
      const query = params.toString();
      void navigate(
        `${campaignsPath(chosenGroupId(next))}${query ? `?${query}` : ''}`,
        { replace: true },
      );
    },
    [navigate, search],
  );

  const set = useCallback(
    <L extends WorkFilterLevel>(
      level: L,
      next: WorkFilterValue[L] | undefined,
    ) => {
      if (level === 'from' || level === 'to') dates.set(level, next);
      else if (level !== 'campaignId')
        go(setWorkFilterLevel(value, level, next));
    },
    [dates, go, value],
  );

  const clear = useCallback(() => go({}), [go]);

  return useMemo(
    () => ({
      value,
      params: dates.params && withoutGroup(dates.params),
      rangeError: dates.rangeError,
      active: isWorkFilterActive(value),
      set,
      clear,
      routeGroupId,
    }),
    [value, dates.params, dates.rangeError, set, clear, routeGroupId],
  );
}
