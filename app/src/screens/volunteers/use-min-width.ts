import { useSyncExternalStore } from 'react';

/**
 * Whether the viewport is at least `width` wide (a CSS length, e.g. `48rem`
 * for Tailwind's `md`). Where `matchMedia` is missing (a test DOM) it answers
 * `true`, the wide layout.
 */
export function useMinWidth(width: string): boolean {
  const query = `(min-width: ${width})`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () =>
      typeof window.matchMedia !== 'function' ||
      window.matchMedia(query).matches,
    () => true,
  );
}
