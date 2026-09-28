import { useEffect, type RefObject } from 'react';

/**
 * Scrolls a tab strip (`tabListClass`) so its active tab is in view, centred
 * when it can be. Under 640 px the strip scrolls sideways (layout X7), so a
 * last tab that is the current one ("Setări", "Toate") would otherwise open
 * hidden past the edge. Does nothing while the strip does not overflow.
 *
 * `active` is whatever identifies the active tab (a route, a tab value); the
 * strip is re-centred when it changes, and when the strip starts to overflow
 * (a window narrowed below 640 px) — not on every resize, so a member's own
 * sideways scroll is left alone. The active tab is found by its marker:
 * `aria-current="page"` (a route), `aria-selected="true"` (a tablist) or
 * `data-active` (Base UI Tabs).
 */
export function useActiveTabInView(
  strip: RefObject<HTMLElement | null>,
  active: unknown,
) {
  useEffect(() => {
    const list = strip.current;
    if (!list || active == null) return;
    const overflows = () => list.scrollWidth > list.clientWidth;
    const centre = () => {
      if (!overflows()) return;
      const current = list.querySelector<HTMLElement>(
        '[aria-current="page"],[aria-selected="true"],[data-active]',
      );
      if (!current) return;
      list.scrollTo({
        left: current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2,
      });
    };
    centre();
    if (typeof ResizeObserver === 'undefined') return;
    let overflowing = overflows();
    const observer = new ResizeObserver(() => {
      const now = overflows();
      if (now && !overflowing) centre();
      overflowing = now;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [strip, active]);
}
