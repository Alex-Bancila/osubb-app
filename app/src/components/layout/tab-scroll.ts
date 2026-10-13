import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router';

/**
 * Bring one tab fully into its track's view by moving the track's own
 * scroll position — never the page's. Nothing happens when it already fits.
 */
export function scrollTabIntoView(
  track: HTMLElement,
  tab: HTMLElement,
  smooth: boolean,
) {
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  const viewLeft = track.scrollLeft;
  const viewRight = viewLeft + track.clientWidth;
  const next =
    left < viewLeft
      ? left
      : right > viewRight
        ? right - track.clientWidth
        : null;
  if (next === null) return;
  if (smooth && typeof track.scrollTo === 'function')
    track.scrollTo({ left: next, behavior: 'smooth' });
  else track.scrollLeft = next;
}

/**
 * After every route change -- the path or the query string, which a Group's
 * tabs use -- the tab matching `selector` (the current one) is scrolled into
 * the track's view, smoothly unless the member prefers reduced motion. Both
 * tab tracks use it (DESIGN.md, Navigation).
 */
export function useScrollCurrentTabIntoView(
  track: RefObject<HTMLElement | null>,
  selector: string,
) {
  const { pathname, search } = useLocation();
  const route = pathname + search;
  useEffect(() => {
    // The route decides which tab is current: that is what this follows.
    if (!route) return;
    const root = track.current;
    const current = root?.querySelector<HTMLElement>(selector);
    if (!root || !current) return;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTabIntoView(root, current, !reduce);
  }, [track, selector, route]);
}
