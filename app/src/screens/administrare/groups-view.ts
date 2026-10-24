import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** The query-string key and the value that shows **Conduse de mine** (#921). */
export const GROUPS_VIEW_KEY = 'vedere';
export const LED_VIEW_VALUE = 'conduse';
/** The value that shows **Arhivate** (#1110, ruling R65). */
export const ARCHIVED_VIEW_VALUE = 'arhivate';

/** **Toate** (the whole structure), **Conduse de mine** or **Arhivate**. */
export type GroupsView = 'all' | 'led' | 'archived';

const VALUES: Record<GroupsView, string | null> = {
  all: null,
  led: LED_VIEW_VALUE,
  archived: ARCHIVED_VIEW_VALUE,
};

/**
 * The Grupuri tab's view. The URL decides — `?vedere=conduse` is the led
 * view, `?vedere=arhivate` the archived one, so a reload, Back and a shared
 * link keep it — but only among the views the viewer has (`available`, the
 * first being where the page opens): a value naming another view is ignored,
 * never an error. Choosing the first view drops the key; choosing replaces
 * the history entry and keeps every other key.
 */
export function useGroupsView(available: readonly GroupsView[]) {
  const [params, setParams] = useSearchParams();
  const requested = params.get(GROUPS_VIEW_KEY);
  const home = available[0] ?? 'all';
  const view: GroupsView =
    available.find((option) => VALUES[option] === requested) ?? home;
  const choose = useCallback(
    (next: GroupsView) =>
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          const value = next === home ? null : VALUES[next];
          if (value) nextParams.set(GROUPS_VIEW_KEY, value);
          else nextParams.delete(GROUPS_VIEW_KEY);
          return nextParams;
        },
        { replace: true },
      ),
    [setParams, home],
  );
  return [view, choose] as const;
}
