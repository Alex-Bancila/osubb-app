import { useEffect, useRef, useState } from 'react';

/**
 * Calls `onEnter` when the element comes into view: the end of a list that
 * loads its next page as the Member reaches it. `margin` starts it early, so
 * the rows are usually there before the end is.
 *
 * It watches only while `armed`. Pass "there is a next page and none is on
 * its way": each page that lands re-arms it, so a page too short to push the
 * end out of view asks for the next one instead of waiting for a scroll that
 * cannot happen. Where the browser has no `IntersectionObserver` nothing is
 * observed; the list keeps its button.
 */
export function useInView(
  onEnter: () => void,
  armed: boolean,
  margin = '600px',
): (element: Element | null) => void {
  const [element, setElement] = useState<Element | null>(null);
  const latest = useRef(onEnter);
  useEffect(() => {
    latest.current = onEnter;
  });
  useEffect(() => {
    if (!armed || !element || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [armed, element, margin]);
  return setElement;
}
