import { useRef, type ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router';
import { cn } from 'cn';
import { useActiveTabInView } from './use-active-tab-in-view';

/**
 * The tab bar's classes. `PageTabs` uses them for routed tabs; Base UI `Tabs`
 * (Taskuri) and a hand-rolled `role="tablist"` (the Group page) use the same
 * two constants, so every tab bar in the app looks the same.
 *
 * - From 640 px the tabs wrap.
 * - Under 640 px they stay on one row that scrolls sideways on its own, with
 *   scroll snap and a fade at each edge (layout X7): only the strip scrolls,
 *   never the page. The strip reaches the page edges (`-mx-4`, the `Page`
 *   gutter) so a tab slides out under the fade instead of being cut at the
 *   gutter; the 4 px above and below leave room for the focus ring.
 * - No margin of its own: in a `Page` the 24 px gap spaces it; elsewhere put
 *   it in a `flex flex-col gap-6` stack.
 * - Pair it with `useActiveTabInView` so the active tab opens in view.
 */
export const tabListClass =
  'relative flex min-w-0 gap-2 sm:flex-wrap max-sm:-mx-4 max-sm:-my-1 max-sm:snap-x max-sm:scroll-px-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1 max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)] max-sm:[&::-webkit-scrollbar]:hidden';

/**
 * One tab: a 44 px target in the text colour, `bg-muted` on hover, the active
 * tab in OSUBB red with a visible focus ring. Active is read from whichever
 * marker the host sets — `data-active` (Base UI), `aria-current` (a route) or
 * `aria-selected` (a tablist). `text-foreground` is explicit because the
 * global `a` colour is OSUBB red (layout X6).
 */
// The focus classes are `focusRingClass`, spelled out so this stays a
// literal constant.
export const tabClass =
  'inline-flex min-h-11 min-w-11 shrink-0 snap-start items-center justify-center rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-foreground no-underline hover:bg-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring data-active:bg-primary data-active:text-primary-foreground data-active:hover:bg-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground aria-[current=page]:hover:bg-primary aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:hover:bg-primary';

export type PageTab = {
  /** The route this tab opens. */
  to: string;
  label: ReactNode;
  /** Match the route exactly, so a parent tab is not active on its children. */
  end?: boolean;
};

/**
 * Routed tabs: a `nav` of links, the current one marked
 * `aria-current="page"`. Sits right under `PageHeader`. On a phone the
 * current tab is scrolled into the strip, so "Setări" is not hidden past the
 * edge when it is the page you are on.
 */
export function PageTabs({
  tabs,
  label,
  className,
}: {
  tabs: readonly PageTab[];
  /** The `nav`'s accessible name. */
  label: string;
  className?: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const active = tabs.find((tab) =>
    matchPath({ path: tab.to, end: tab.end ?? false }, pathname),
  )?.to;
  useActiveTabInView(nav, active);
  return (
    <nav
      ref={nav}
      aria-label={label}
      data-slot="page-tabs"
      className={cn(tabListClass, className)}
    >
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
