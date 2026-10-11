import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { cn } from 'cn';
import { SlidingThumb, useSlidingThumb } from '../ui/sliding-thumb';
import { useScrollCurrentTabIntoView } from './tab-scroll';

/**
 * The app's one tab look (DESIGN.md, Navigation): a pill track, the selected
 * tab inked on a light thumb that slides to it — the same control as the
 * phone's bar and the page view switch. `PageTabs` draws it for routed tabs;
 * Base UI `Tabs` (Profil, Taskuri, a Member's page) and a hand-rolled
 * `role="tablist"` use the same constants, so no page has its own.
 *
 * - The track is as wide as the content column and its tabs share it; it has
 *   no margin of its own (in a `Page` the 24 px gap spaces it).
 * - Tabs never shrink or truncate. When they do not fit, the track scrolls
 *   sideways with no visible scrollbar and the current tab is brought into
 *   view (`useScrollCurrentTabIntoView`). With `tabLabelsFrom`, narrower
 *   screens still collapse the other tabs to icons first; the track scrolls
 *   only when even those overflow.
 */
export const tabListClass =
  'relative flex w-full min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg border border-border bg-(--surface-3) p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The thumb under the selected tab. For Base UI `Tabs`, put it on a
 * `Tabs.Indicator` as the list's first child: it reads the indicator's
 * `--active-tab-left` / `--active-tab-width`. `PageTabs` measures its own.
 */
export const tabThumbClass =
  'pointer-events-none absolute inset-y-[3px] left-0 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-(--text) transition-[translate,width] duration-200 ease-out motion-reduce:transition-none';

/**
 * One tab: a 36 px segment with a 44 px hit area, an optional 16 px icon
 * before its label. Selected is read from whichever marker the host sets —
 * `data-active` (Base UI), `aria-current` (a route) or `aria-selected` (a
 * tablist) — and inks the tab itself once the thumb has arrived (the 200 ms
 * delay), so it is inked even where no thumb is drawn or measured.
 */
// The focus classes are `focusRingClass`, spelled out so this stays a
// literal constant.
export const tabClass =
  'relative z-1 inline-flex min-h-[36px] min-w-11 flex-auto shrink-0 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-bold whitespace-nowrap text-muted-foreground no-underline [transition:color_200ms] after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 data-active:bg-(--text) data-active:text-(--surface) data-active:[transition:color_200ms,background-color_0s_200ms] data-active:hover:text-(--surface) aria-[current=page]:bg-(--text) aria-[current=page]:text-(--surface) aria-[current=page]:[transition:color_200ms,background-color_0s_200ms] aria-[current=page]:hover:text-(--surface) aria-selected:bg-(--text) aria-selected:text-(--surface) aria-selected:[transition:color_200ms,background-color_0s_200ms] aria-selected:hover:text-(--surface)';

export type TabLabelsFrom = 'always' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * From which width every tab spells its name; below it only the selected one
 * does and the rest are their icons (each keeps its name for a screen
 * reader). `tab` goes on the tab beside `tabClass`, `label` on the span
 * around its text. Every tab needs an icon unless this is `always`.
 */
// oxlint-disable-next-line react/only-export-components
export const tabLabelsFrom: Record<
  TabLabelsFrom,
  { tab: string; label: string }
> = {
  always: { tab: '', label: 'min-w-0' },
  sm: {
    tab: 'max-sm:flex-none max-sm:px-3 max-sm:aria-selected:flex-auto max-sm:aria-[current=page]:flex-auto max-sm:data-active:flex-auto',
    label:
      'min-w-0 max-sm:sr-only max-sm:in-aria-selected:not-sr-only max-sm:in-aria-[current=page]:not-sr-only max-sm:in-data-active:not-sr-only',
  },
  md: {
    tab: 'max-md:flex-none max-md:px-3 max-md:aria-selected:flex-auto max-md:aria-[current=page]:flex-auto max-md:data-active:flex-auto',
    label:
      'min-w-0 max-md:sr-only max-md:in-aria-selected:not-sr-only max-md:in-aria-[current=page]:not-sr-only max-md:in-data-active:not-sr-only',
  },
  lg: {
    tab: 'max-lg:flex-none max-lg:px-3 max-lg:aria-selected:flex-auto max-lg:aria-[current=page]:flex-auto max-lg:data-active:flex-auto',
    label:
      'min-w-0 max-lg:sr-only max-lg:in-aria-selected:not-sr-only max-lg:in-aria-[current=page]:not-sr-only max-lg:in-data-active:not-sr-only',
  },
  xl: {
    tab: 'max-xl:flex-none max-xl:px-3 max-xl:aria-selected:flex-auto max-xl:aria-[current=page]:flex-auto max-xl:data-active:flex-auto',
    label:
      'min-w-0 max-xl:sr-only max-xl:in-aria-selected:not-sr-only max-xl:in-aria-[current=page]:not-sr-only max-xl:in-data-active:not-sr-only',
  },
  '2xl': {
    tab: 'max-2xl:flex-none max-2xl:px-3 max-2xl:aria-selected:flex-auto max-2xl:aria-[current=page]:flex-auto max-2xl:data-active:flex-auto',
    label:
      'min-w-0 max-2xl:sr-only max-2xl:in-aria-selected:not-sr-only max-2xl:in-aria-[current=page]:not-sr-only max-2xl:in-data-active:not-sr-only',
  },
};

export type PageTab = {
  /** The route this tab opens. */
  to: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** Match the route exactly, so a parent tab is not active on its children. */
  end?: boolean;
};

/**
 * Routed tabs: a `nav` of links on the pill track, the current one marked
 * `aria-current="page"` and under the thumb. Sits right under `PageHeader`.
 * With `labelsFrom`, narrower screens show the other tabs as icons.
 */
export function PageTabs({
  tabs,
  label,
  labelsFrom = 'always',
  className,
}: {
  tabs: readonly PageTab[];
  /** The `nav`'s accessible name. */
  label: string;
  /** From which width every tab spells its name (each tab then needs an icon). */
  labelsFrom?: TabLabelsFrom;
  className?: string;
}) {
  // A route change re-renders this, and the thumb is measured after it.
  useLocation();
  // Where the current tab is, for the thumb; unmeasured, the tab inks itself.
  const { track: nav, thumb } = useSlidingThumb<HTMLElement>(
    '[aria-current="page"]',
  );
  // A tab outside the scrolled part of the track comes into view by itself.
  useScrollCurrentTabIntoView(nav, '[aria-current="page"]');
  const sizes = tabLabelsFrom[labelsFrom];
  return (
    <nav
      ref={nav}
      aria-label={label}
      data-slot="page-tabs"
      className={cn(tabListClass, className)}
    >
      <SlidingThumb thumb={thumb} />
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={cn(tabClass, sizes.tab)}
          >
            {Icon && <Icon aria-hidden="true" />}
            <span className={sizes.label}>{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
