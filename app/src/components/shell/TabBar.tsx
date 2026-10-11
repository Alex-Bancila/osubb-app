import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Drawer } from '@base-ui/react/drawer';
import { Ellipsis } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { cn } from '../../lib/utils';
import { usePopMotion } from '../../lib/motion';
import { Badge } from '../ui/badge';
import { isNavItemActive, type NavItem } from './navItems';

type Badges = Partial<Record<string, { count: number; label: string }>>;

// One place on the bar: a 44 px icon, the same for a tab and for Mai mult.
const tabClass =
  'relative z-1 flex h-11 min-w-11 flex-1 cursor-pointer items-center justify-center rounded-full text-muted-foreground no-underline transition-colors duration-200 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring data-current:text-accent-foreground motion-reduce:transition-none';

/**
 * The phone's navigation (2026-10-11): a capsule floating over the foot of
 * the page with the member's four places and **Mai mult**, which opens the
 * drawer of every other page (`MoreDrawer`). All five are icons, each with
 * its name for a screen reader; a tinted thumb slides to the current one —
 * or to Mai mult, on a page from its drawer. The page's plus button stands
 * beside the capsule (the shell's bottom bar), the one solid red thing here.
 *
 * While a phone keyboard is open the bar steps aside (#1013). It floats over
 * the page: frosted, with the page scrolling under it; the shell leaves its
 * height of room at the page's end.
 */
export function TabBar({
  tabs,
  more,
  badges,
}: {
  tabs: readonly NavItem[];
  /** The drawer's pages; with none, the bar has no Mai mult. */
  more: readonly NavItem[];
  badges: Badges;
}) {
  const { pathname } = useLocation();
  const active = tabs.find((item) => isNavItemActive(item, pathname))?.path;
  const inMore =
    !active && more.some((item) => isNavItemActive(item, pathname));
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

  const measure = useCallback(() => {
    const current = bar.current?.querySelector<HTMLElement>('[data-current]');
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
  }, []);
  // After every render: the route or the bar's places may have changed.
  useLayoutEffect(measure);
  useEffect(() => {
    const root = bar.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <nav
      aria-label="Navigare rapidă"
      data-slot="tab-bar"
      className="max-w-80 min-w-0 flex-1 lg:hidden"
    >
      <div
        ref={bar}
        // No gap: five 44 px places and the plus just fit a 320 px phone.
        className="relative flex rounded-full border border-border bg-card/80 p-[5px] shadow-(--sh-md) backdrop-blur-md"
      >
        {thumb && (
          <span
            aria-hidden="true"
            data-slot="tab-thumb"
            className={cn(
              'pointer-events-none absolute inset-y-[5px] left-0 rounded-full bg-accent transition-[translate,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none',
              wasEmpty && 'motion-grow',
            )}
            style={{ width: thumb.width, translate: `${thumb.left}px 0` }}
          />
        )}
        {leaving && (
          <span
            aria-hidden="true"
            data-slot="tab-thumb-leaving"
            className="pointer-events-none absolute inset-y-[5px] left-0 rounded-full bg-accent motion-shrink"
            style={{ width: leaving.width, translate: `${leaving.left}px 0` }}
            onAnimationEnd={() => setLeaving(null)}
          />
        )}
        {tabs.map((item) => {
          const Icon = item.icon;
          const badge = badges[item.path];
          const current = item.path === active;
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={current ? 'page' : undefined}
              data-current={current || undefined}
              className={cn(tabClass, current && !thumb && 'bg-accent')}
            >
              <span className="relative inline-flex shrink-0">
                <Icon className="size-5.5 shrink-0" aria-hidden="true" />
                {badge && <TabCount count={badge.count} />}
              </span>
              <span className="sr-only">{item.label}</span>
              {badge && <span className="sr-only">, {badge.label}</span>}
            </Link>
          );
        })}
        {more.length > 0 && (
          <MoreDrawer
            items={more}
            badges={badges}
            current={inMore}
            className={cn(tabClass, inMore && !thumb && 'bg-accent')}
          />
        )}
      </div>
    </nav>
  );
}

/**
 * **Mai mult**, the phone bar's last place: a drawer that rises from the foot
 * of the screen with every page the bar itself does not hold (Grupuri, and
 * what the viewer's capabilities add), one row each. A row
 * opens its page and the drawer closes; so does a swipe down, a tap outside
 * or Escape. The button carries the counts of the pages behind it, so one
 * is seen without opening the drawer.
 */
function MoreDrawer({
  items,
  badges,
  current,
  className,
}: {
  items: readonly NavItem[];
  badges: Badges;
  /** The page is one of the drawer's: the bar's thumb stands on the button. */
  current: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const counted = items.flatMap((item) => badges[item.path] ?? []);
  const count = counted.reduce((sum, badge) => sum + badge.count, 0);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger
        data-slot="more-tab"
        data-current={current || undefined}
        className={cn('border-0 bg-transparent p-0', className)}
      >
        <span className="relative inline-flex shrink-0">
          <Ellipsis className="size-5.5 shrink-0" aria-hidden="true" />
          {count > 0 && <TabCount count={count} />}
        </span>
        <span className="sr-only">Mai mult</span>
        {counted.map((badge) => (
          <span key={badge.label} className="sr-only">
            , {badge.label}
          </span>
        ))}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-70 bg-black/40 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:transition-none" />
        <Drawer.Viewport className="fixed inset-0 z-70 flex items-end justify-center">
          <Drawer.Popup
            data-slot="more-drawer"
            className="w-full max-w-md [transform:translateY(var(--drawer-swipe-movement-y))] rounded-t-[1.75rem] border border-b-0 border-border bg-card pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-xl outline-none transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)] data-swiping:duration-0 data-swiping:select-none motion-reduce:transition-none"
          >
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-muted-foreground/40"
            />
            <Drawer.Content>
              <Drawer.Title className="sr-only">Mai mult</Drawer.Title>
              <nav aria-label="Mai mult">
                <ul className="m-0 flex list-none flex-col p-2">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const badge = badges[item.path];
                    const isActive = isNavItemActive(item, pathname);
                    return (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => setOpen(false)}
                          className="flex min-h-12 items-center gap-4 rounded-2xl px-4 text-sm font-semibold text-foreground no-underline outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                        >
                          <Icon
                            className="size-5 shrink-0 text-muted-foreground in-aria-[current=page]:text-accent-foreground"
                            aria-hidden="true"
                          />
                          {item.label}
                          {badge && (
                            <Badge variant="destructive" className="ml-auto">
                              <span aria-hidden="true">{badge.count}</span>
                              <span className="sr-only">{badge.label}</span>
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** A count on an icon's corner, ringed in the surface it sits on. */
function TabCount({ count }: { count: number }) {
  return (
    <Badge
      variant="destructive"
      className="absolute -top-1.5 left-3 h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-white ring-2 ring-card dark:bg-destructive"
    >
      <PopCount count={count} />
    </Badge>
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
