import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** The query-string key and the value that shows **Conduse de mine** (#921). */
export const GROUPS_VIEW_KEY = 'vedere';
export const LED_VIEW_VALUE = 'conduse';

/** **Toate** (the whole structure) or **Conduse de mine**. */
export type GroupsView = 'all' | 'led';

/**
 * The Grupuri tab's view. The URL decides — `?vedere=conduse` is the led
 * view, so a reload, Back and a shared link keep it — but only while the
 * viewer has that view to choose (`available`): anyone else gets the whole
 * structure and the key is ignored, never an error. Choosing replaces the
 * history entry and keeps every other key.
 */
export function useGroupsView(available: boolean) {
  const [params, setParams] = useSearchParams();
  const view: GroupsView =
    available && params.get(GROUPS_VIEW_KEY) === LED_VIEW_VALUE ? 'led' : 'all';
  const choose = useCallback(
    (next: GroupsView) =>
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          if (next === 'led') nextParams.set(GROUPS_VIEW_KEY, LED_VIEW_VALUE);
          else nextParams.delete(GROUPS_VIEW_KEY);
          return nextParams;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [view, choose] as const;
}
