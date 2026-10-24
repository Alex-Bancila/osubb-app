import { useSyncExternalStore } from 'react';

const COARSE = '(pointer: coarse)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(COARSE);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches
  );
}

/**
 * Whether the device's main pointer is a finger (`pointer: coarse`), observed
 * live: a tablet that gains a mouse changes its answer. Input decides which
 * Formatted Text toolbar a Member gets, not width (ruling R60, decision 5):
 * touch gets the keyboard bar, a mouse or trackpad the top toolbar. Without
 * `matchMedia` (a test DOM) it is `false`, the mouse.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
