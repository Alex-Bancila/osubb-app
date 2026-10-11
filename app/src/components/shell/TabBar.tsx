import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router';
import { cn } from '../../lib/utils';
import { usePopMotion } from '../../lib/motion';
import { Badge } from '../ui/badge';
import { isNavItemActive, type NavItem } from './navItems';

const badgeClass =
  'h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-white dark:bg-destructive';

type Badges = Partial<Record<string, { count: number; label: string }>>;

/**
 * The phone's navigation (2026-10-11): a capsule floating over the foot of
 * the page with the member's five places. The current one opens to show its
 * name on a light thumb that slides to it; the other four are their icons
 * (each keeps its name for a screen reader). No tab is louder than the rest —
 * the page's plus button is the one solid red thing in this corner.
 *
 * A name too long for the space it gets ("Administrare" on a 320 px phone)
 * falls back to the item's `shortLabel`. While a phone keyboard is open the
 * bar steps aside (#1013). The bar floats over the page: frosted, with the
 * page scrolling under it; the shell leaves its height of room at the page's
 * end.
 */
export function TabBar({
  tabs,
  badges,
  under,
}: {
  tabs: readonly NavItem[];
  badges: Badges;
  /**
   * The tab the current page sits under without being it (Acasă, for a page
   * reached from its tiles): outlined and named, where the current tab is
   * filled. Ignored while a tab is current.
   */
  under?: string;
}) {
  const { pathname } = useLocation();
  const active = tabs.find((item) => isNavItemActive(item, pathname))?.path;
  const bar = useRef<HTMLDivElement>(null);
  // Where the current tab is, for the thumb; unmeasured (first paint, no
  // current tab), the tab inks itself instead.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  // The thumb as it last stood, drawn once more while it shrinks away when
  // the page leaves the bar (a tab to Profil): it has nowhere to slide to.
  const lastThumb = useRef<{ left: number; width: number } | null>(null);
  const [leaving, setLeaving] = useState<{
    left: number;
    width: number;
  } | null>(null);
  // Whether the bar has stood with no tab selected (Profil, Notificări): the
  // thumb then has nowhere to slide from, so it grows in on the tab instead.
  const [wasEmpty, setWasEmpty] = useState(false);
  // The tab whose name did not fit, which says its short one; a new tab or
  // a new width starts from the full name again.
  const [shortFor, setShortFor] = useState<string | null>(null);
  const short = shortFor !== null && shortFor === active;

  const measure = useCallback(() => {
    const current = bar.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    const next =
      current && current.offsetWidth > 0
        ? { left: current.offsetLeft, width: current.offsetWidth }
        : null;
    setThumb((previous) =>
      previous?.left === next?.left && previous?.width === next?.width
        ? previous
        : next,
    );
    if (!current) setWasEmpty(true);
    if (next) setLeaving(null);
    else if (lastThumb.current) setLeaving(lastThumb.current);
    lastThumb.current = next;
    const label = current?.querySelector<HTMLElement>(
      '[data-slot="tab-label"]',
    );
    if (label && label.scrollWidth > label.clientWidth + 1)
      setShortFor(current?.dataset.path ?? null);
  }, []);
  // After every render: the route, a count or the label may have changed.
  useLayoutEffect(measure);
  useEffect(() => {
    const root = bar.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setShortFor(null);
      measure();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <nav
      aria-label="Navigare rapidă"
      data-slot="tab-bar"
      className="pointer-events-none relative z-10 self-end px-3 pt-2 pb-[calc(.75rem+env(safe-area-inset-bottom))] [grid-area:main] *:pointer-events-auto keyboard:hidden lg:hidden"
    >
      <div
        ref={bar}
        className="relative mx-auto flex max-w-md gap-1 rounded-full border border-border bg-card/80 p-[5px] shadow-(--sh-md) backdrop-blur-md"
      >
        {thumb && (
          <span
            aria-hidden="true"
            data-slot="tab-thumb"
            className={cn(
              'pointer-events-none absolute inset-y-[5px] left-0 rounded-full bg-(--text) transition-[translate,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none',
              wasEmpty && 'motion-grow',
            )}
            style={{ width: thumb.width, translate: `${thumb.left}px 0` }}
          />
        )}
        {leaving && (
          <span
            aria-hidden="true"
            data-slot="tab-thumb-leaving"
            className="pointer-events-none absolute inset-y-[5px] left-0 rounded-full bg-(--text) motion-shrink"
            style={{ width: leaving.width, translate: `${leaving.left}px 0` }}
            onAnimationEnd={() => setLeaving(null)}
          />
        )}
        {tabs.map((item) => {
          const Icon = item.icon;
          const badge = badges[item.path];
          const current = item.path === active;
          const parent = !active && item.path === under;
          return (
            <Link
              key={item.path}
              to={item.path}
              data-path={item.path}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'relative z-1 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold whitespace-nowrap no-underline transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none',
                current
                  ? 'min-w-0 flex-1 text-(--surface)'
                  : parent
                    ? 'min-w-0 flex-[2] text-foreground ring-[1.5px] ring-muted-foreground/70 ring-inset'
                    : 'text-muted-foreground hover:text-foreground',
                // On a page that is none of the five (Profil, Notificări)
                // nothing opens, so the five share the bar evenly.
                !current && !parent && (active ? 'flex-none' : 'flex-1'),
                current && !thumb && 'bg-(--text)',
              )}
            >
              {/* Unselected, the count sits on the icon's corner, ringed in
                  the bar's colour; selected, it follows the label. */}
              <span className="relative inline-flex shrink-0">
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {badge && !current && !parent && (
                  <Badge
                    variant="destructive"
                    className={cn(
                      badgeClass,
                      'absolute -top-1.5 left-3 ring-2 ring-card',
                    )}
                  >
                    <PopCount count={badge.count} />
                  </Badge>
                )}
              </span>
              <span
                data-slot="tab-label"
                className={cn(
                  current || parent
                    ? 'min-w-0 overflow-hidden text-clip'
                    : 'sr-only',
                )}
              >
                {current && short && item.shortLabel
                  ? item.shortLabel
                  : item.label}
              </span>
              {badge && (current || parent) && (
                <Badge variant="destructive" className={badgeClass}>
                  <PopCount count={badge.count} />
                </Badge>
              )}
              {badge && <span className="sr-only">, {badge.label}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** A badge's number; it pops when it changes. */
function PopCount({ count }: { count: number }) {
  const pop = usePopMotion<HTMLSpanElement>(count);
  return (
    <span ref={pop} aria-hidden="true" className="inline-block">
      {count}
    </span>
  );
}
