import { useLayoutEffect, useRef } from 'react';

/** Whether the member's system allows motion (and the browser can tell). */
export function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

/**
 * Plays a short move on an element whenever `key` changes, without
 * remounting it. Nothing plays on the first render, under reduced motion, or
 * where the browser has no Web Animations.
 */
function useMotionOnChange<T extends Element>(
  key: string | number | boolean | undefined,
  keyframes: Keyframe[],
  duration: number,
) {
  const ref = useRef<T>(null);
  const seen = useRef(key);
  const move = useRef(keyframes);
  useLayoutEffect(() => {
    const before = seen.current;
    if (before === key) return;
    seen.current = key;
    // A value that has only just loaded has not changed.
    if (before === undefined) return;
    const element = ref.current;
    if (!element || typeof element.animate !== 'function' || !motionAllowed())
      return;
    element.animate(move.current, { duration, easing: 'ease-out' });
  }, [key, duration]);
  return ref;
}

const ENTER: Keyframe[] = [
  { opacity: 0, translate: '0 6px' },
  { opacity: 1, translate: '0 0' },
];
const POP: Keyframe[] = [{ scale: 1 }, { scale: 1.3 }, { scale: 1 }];

/**
 * Content that arrives when `key` changes — a page behind the shell, the
 * section under routed tabs: the `motion-enter` move, replayed in place.
 */
export function useEnterMotion<T extends HTMLElement>(key: string) {
  return useMotionOnChange<T>(key, ENTER, 180);
}

/** A count or a switch that has just changed gives one small pop. */
export function usePopMotion<T extends Element>(
  key: string | number | boolean | undefined,
) {
  return useMotionOnChange<T>(key, POP, 250);
}
