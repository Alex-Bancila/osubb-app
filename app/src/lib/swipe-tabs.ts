import { useRef, type TouchEvent, type TouchEventHandler } from 'react';

/**
 * A finger swipe between tab pages (Alex, 2026-10-11): on a touch screen a
 * swipe left on a tab's panel opens the next tab, a swipe right the previous
 * one, and the strip's thumb slides along as if the tab were tapped. Nothing
 * else changes: a tap still works, the strip still scrolls, the look is the
 * same (DESIGN.md, Navigation).
 *
 * Only a clear swipe counts: at least `SWIPE_MIN_DISTANCE` sideways and at
 * least twice as far sideways as up or down, so a scroll with a slanted
 * finger is left to the browser. A swipe that starts in a field, on
 * something that scrolls sideways itself (a chip row, a wide table, the tab
 * strip) or inside `data-swipe-ignore` belongs to that thing. Two fingers
 * are a zoom, never a swipe. The browser's own scrolling is never prevented.
 */

/** The least sideways travel that reads as a swipe (px). */
export const SWIPE_MIN_DISTANCE = 48;

export type SwipeDirection = 'next' | 'previous';

type Point = { x: number; y: number };

/** `next` for a swipe to the left, `previous` for one to the right, null for anything less. */
export function readSwipe(start: Point, end: Point): SwipeDirection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy))
    return null;
  return dx < 0 ? 'next' : 'previous';
}

/**
 * Whether a touch that starts on `target` belongs to something else between
 * it and `boundary`: a field, an opted-out part (`data-swipe-ignore`), or an
 * element that scrolls sideways itself.
 */
export function swipeStartsElsewhere(
  target: EventTarget | null,
  boundary: Element,
): boolean {
  if (!(target instanceof Element)) return false;
  for (
    let node: Element | null = target;
    node && node !== boundary;
    node = node.parentElement
  ) {
    if (
      node instanceof HTMLElement &&
      (node.isContentEditable ||
        node.matches('input,textarea,select,[data-swipe-ignore]'))
    )
      return true;
    const { overflowX } = getComputedStyle(node);
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      node.scrollWidth > node.clientWidth
    )
      return true;
  }
  return false;
}

type Handlers = {
  onTouchStart: TouchEventHandler<HTMLElement>;
  onTouchMove: TouchEventHandler<HTMLElement>;
  onTouchEnd: TouchEventHandler<HTMLElement>;
  onTouchCancel: TouchEventHandler<HTMLElement>;
};

function pointOf(
  touch: { clientX: number; clientY: number } | undefined,
): Point | null {
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/**
 * Touch handlers for the element that holds the tab panels. `order` is the
 * tabs as the strip shows them, `current` the open one; `onSelect` receives
 * the neighbour a swipe asks for, exactly as a tap on it would.
 */
export function useSwipeTabs<T>({
  order,
  current,
  onSelect,
}: {
  order: readonly T[];
  current: T;
  onSelect: (next: T) => void;
}): Handlers {
  const start = useRef<Point | null>(null);
  const last = useRef<Point | null>(null);
  function begin(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (
      event.touches.length !== 1 ||
      swipeStartsElsewhere(event.target, event.currentTarget)
    ) {
      start.current = null;
      return;
    }
    start.current = last.current = pointOf(touch);
  }
  function move(event: TouchEvent<HTMLElement>) {
    if (!start.current) return;
    if (event.touches.length !== 1) {
      start.current = null;
      return;
    }
    last.current = pointOf(event.touches[0]);
  }
  function end(event: TouchEvent<HTMLElement>) {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const to = pointOf(event.changedTouches[0]) ?? last.current;
    if (!to) return;
    const direction = readSwipe(from, to);
    if (!direction) return;
    const index = order.indexOf(current);
    if (index < 0) return;
    const next = order[direction === 'next' ? index + 1 : index - 1];
    if (next !== undefined) onSelect(next);
  }
  function cancel() {
    start.current = null;
  }
  return {
    onTouchStart: begin,
    onTouchMove: move,
    onTouchEnd: end,
    onTouchCancel: cancel,
  };
}
