import { type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from 'cn';

/**
 * The tab bar's classes. `PageTabs` uses them for routed tabs; Base UI `Tabs`
 * (Taskuri) and a hand-rolled `role="tablist"` use the same two constants, so
 * every tab bar in the app looks the same. The bar wraps rather than
 * scrolling sideways at 375 px, and sits 24 px above the content.
 */
export const tabListClass = 'mb-6 flex min-w-0 flex-wrap gap-2';

/**
 * One tab: a 44 px target, the active tab in OSUBB red. Active is read from
 * whichever marker the host sets — `data-active` (Base UI), `aria-current`
 * (a route) or `aria-selected` (a tablist).
 */
export const tabClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:bg-primary data-active:text-primary-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground aria-selected:bg-primary aria-selected:text-primary-foreground';

export type PageTab = {
  /** The route this tab opens. */
  to: string;
  label: ReactNode;
  /** Match the route exactly, so a parent tab is not active on its children. */
  end?: boolean;
};

/**
 * Routed tabs: a `nav` of links, the current one marked
 * `aria-current="page"`. Sits right under `PageHeader`.
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
  return (
    <nav
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
