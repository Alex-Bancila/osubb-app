import { useCallback, useLayoutEffect, useRef } from 'react';

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

const FAB_IN: Keyframe[] = [
  { opacity: 0, scale: 0.55 },
  { opacity: 1, scale: 1.06, offset: 0.6 },
  { opacity: 1, scale: 1 },
];
const FAB_PLUS_IN: Keyframe[] = [{ rotate: '-90deg' }, { rotate: '0deg' }];
const FAB_OUT: Keyframe[] = [
  { opacity: 1, scale: 1 },
  { opacity: 0, scale: 0.7 },
];

/** The copy of a create button that has gone, popping out where it stood. */
function popOut(copy: HTMLElement, slot: HTMLElement) {
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.dataset.slot = 'fab-ghost';
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  // Over the spot the button held: the slot's start on a phone, its end
  // from `lg`, where the bar's side aligns the button right.
  copy.classList.add(
    'pointer-events-none',
    'absolute',
    'bottom-0',
    'left-0',
    'lg:right-0',
    'lg:left-auto',
  );
  slot.append(copy);
  const move = copy.animate(FAB_OUT, {
    duration: 160,
    easing: 'cubic-bezier(0.4, 0, 1, 1)',
    fill: 'forwards',
  });
  const remove = () => copy.remove();
  move.finished.then(remove, remove);
}

/**
 * The page's create button pops (Alex, 2026-10-14, option 1 of five): in
 * over 360 ms with a small overshoot while its plus turns a quarter, out in
 * 160 ms. Returns the ref for the element that wraps the button.
 *
 * The button leaves with its page, so the way out is played by a copy left
 * in `slot`: inert, hidden from assistive technology, gone when its move
 * ends. The copy is made a microtask after the button detaches, so React
 * attaching the same button again at once (StrictMode) leaves none. Nothing
 * plays under reduced motion or without Web Animations, and without a slot
 * (a screen outside the shell) the button simply goes.
 */
export function useFabPresence(slot: HTMLElement | null) {
  const leaving = useRef<HTMLElement | null>(null);
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      leaving.current = null;
      if (typeof element.animate === 'function' && motionAllowed()) {
        element.animate(FAB_IN, {
          duration: 360,
          easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.1)',
        });
        element.querySelector('svg')?.animate(FAB_PLUS_IN, {
          duration: 360,
          easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
        });
      }
      return () => {
        // Judged when the button goes: the member may have turned motion off.
        if (!slot || typeof element.animate !== 'function' || !motionAllowed())
          return;
        const copy = element.cloneNode(true) as HTMLElement;
        leaving.current = copy;
        queueMicrotask(() => {
          if (leaving.current !== copy) return;
          leaving.current = null;
          if (typeof copy.animate === 'function') popOut(copy, slot);
        });
      };
    },
    [slot],
  );
}
