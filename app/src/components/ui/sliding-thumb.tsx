import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type ThumbBox = { left: number; width: number };

/**
 * Where the selected segment of a pill track is, for the one thumb that
 * slides to it (DESIGN.md, Motion). `selector` finds the selected segment
 * inside the track — `[aria-current="page"]`, `[aria-pressed="true"]`,
 * `[aria-checked="true"]`. Measured after every render and whenever the track
 * resizes. Unmeasured (the first paint, a hidden track, a test's DOM) it is
 * `null`, and the segment inks itself instead.
 * Put the returned `track` ref on the track.
 */
// oxlint-disable-next-line react/only-export-components
export function useSlidingThumb<T extends HTMLElement>(selector: string) {
  const track = useRef<T>(null);
  const [thumb, setThumb] = useState<ThumbBox | null>(null);
  const measure = useCallback(() => {
    const selected = track.current?.querySelector<HTMLElement>(selector);
    const next =
      selected && selected.offsetWidth > 0
        ? { left: selected.offsetLeft, width: selected.offsetWidth }
        : null;
    setThumb((current) =>
      current?.left === next?.left && current?.width === next?.width
        ? current
        : next,
    );
  }, [selector]);
  // After every render: the selection, or a label, may have changed.
  useLayoutEffect(measure);
  // And when the track itself resizes (a breakpoint, a late font).
  useEffect(() => {
    const root = track.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);
  return { track, thumb };
}

/** The thumb itself: the track's first child, under its segments. */
export function SlidingThumb({
  thumb,
  slot = 'tab-thumb',
}: {
  thumb: ThumbBox | null;
  slot?: string;
}) {
  if (!thumb) return null;
  return (
    <span
      aria-hidden="true"
      data-slot={slot}
      className="pointer-events-none absolute inset-y-[3px] left-0 rounded-md bg-(--text) transition-[translate,width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: thumb.width, translate: `${thumb.left}px 0` }}
    />
  );
}
