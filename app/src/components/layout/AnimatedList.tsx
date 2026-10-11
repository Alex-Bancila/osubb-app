import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from 'cn';
import { motionAllowed } from '../../lib/motion';

type Entry = { key: string; node: ReactNode };
type Ghost = Entry & { after: string | null };

/** More rows than this leaving at once is a new list, not a row leaving. */
const MOST_LEAVING = 6;

/**
 * A one-column list whose rows arrive and leave instead of snapping
 * (DESIGN.md, Motion): a new row fades up into place; a row that has left —
 * a Task acted on, a filter narrowing the list — stays for 200 ms as an inert
 * copy that fades and closes the gap behind it. Under reduced motion, and
 * where the browser has no Web Animations, a row is simply there or not.
 *
 * It is a `ul` of `li`s, a flex column (the closing gap needs one): pass the
 * gap in `className`.
 */
export function AnimatedList<T>({
  items,
  getKey,
  children: render,
  className,
  itemClassName,
  ...props
}: Omit<ComponentProps<'ul'>, 'children'> & {
  items: readonly T[];
  getKey: (item: T) => string | number;
  children: (item: T) => ReactNode;
  itemClassName?: string;
}) {
  const live: Entry[] = items.map((item) => ({
    key: String(getKey(item)),
    node: render(item),
  }));
  const signature = live.map((entry) => entry.key).join('\n');
  // The rows as they last were, to tell which have left since.
  const [shown, setShown] = useState({ signature, entries: live });
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const collapsing = useRef(new WeakSet<HTMLElement>());

  if (shown.signature !== signature) {
    const now = new Set(live.map((entry) => entry.key));
    const gone: Ghost[] = [];
    let after: string | null = null;
    for (const entry of shown.entries) {
      if (now.has(entry.key)) after = entry.key;
      else gone.push({ ...entry, after });
    }
    const leaving = motionAllowed() && gone.length <= MOST_LEAVING ? gone : [];
    setShown({ signature, entries: live });
    setGhosts([
      // A row that came back is live again, not leaving.
      ...ghosts.filter(
        (ghost) =>
          !now.has(ghost.key) &&
          !leaving.some((entry) => entry.key === ghost.key),
      ),
      ...leaving,
    ]);
  }

  const drop = (key: string) =>
    setGhosts((current) => current.filter((ghost) => ghost.key !== key));

  const collapse = (key: string) => (element: HTMLLIElement | null) => {
    if (!element || collapsing.current.has(element)) return;
    collapsing.current.add(element);
    if (typeof element.animate !== 'function') return drop(key);
    const gap = element.parentElement
      ? Number.parseFloat(getComputedStyle(element.parentElement).rowGap) || 0
      : 0;
    element.style.overflow = 'hidden';
    const closing = element.animate(
      [
        { height: `${element.offsetHeight}px`, opacity: 1, marginBottom: 0 },
        { height: 0, opacity: 0, marginBottom: `${-gap}px` },
      ],
      { duration: 200, easing: 'ease-out', fill: 'forwards' },
    );
    closing.onfinish = () => drop(key);
    closing.oncancel = () => drop(key);
  };

  // A copy closes where its row was: after the row that stood before it, or
  // at the top when that one is gone too.
  const liveKeys = new Set(live.map((entry) => entry.key));
  const ghostsAfter = (key: string | null) =>
    ghosts
      .filter(
        (ghost) =>
          (ghost.after !== null && liveKeys.has(ghost.after)
            ? ghost.after
            : null) === key,
      )
      .map((ghost) => (
        <li
          key={`leaving:${ghost.key}`}
          ref={collapse(ghost.key)}
          aria-hidden="true"
          inert
          data-leaving=""
          className={cn('min-w-0', itemClassName)}
        >
          {ghost.node}
        </li>
      ));

  return (
    <ul
      className={cn('m-0 flex min-w-0 list-none flex-col p-0', className)}
      {...props}
    >
      {ghostsAfter(null)}
      {live.map((entry) => [
        <li
          key={entry.key}
          className={cn('min-w-0 motion-enter', itemClassName)}
        >
          {entry.node}
        </li>,
        ...ghostsAfter(entry.key),
      ])}
    </ul>
  );
}
