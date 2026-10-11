import {
  Bell,
  CalendarDays,
  Trophy,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  Network,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { matchPath } from 'react-router';
import type { Capabilities, Capability } from '../../lib/capabilities';

export type NavItem = {
  path: string;
  /** The name in the sidebar, in a phone's Mai mult drawer and, for a tab, the
   *  one a screen reader says. */
  label: string;
  icon: LucideIcon;
  /** Shown to everyone when absent; otherwise gated on this server
   *  capability (`my_capabilities()`, live rank and Group Roles). */
  capability?: Capability;
  /**
   * The routes the item is active on, as whole React Router patterns, when
   * its path and everything below it is too wide: Administrare and Campanii
   * share `/administrare/…`, so each names its own pages and the sidebar never
   * marks both (#825).
   */
  activeOn?: readonly string[];
};

/**
 * The Notification centre, named once: the shell needs the path to decide
 * which entry carries the unread badge, and hard-coding it twice is how the
 * badge ends up on nothing after a rename.
 */
export const NOTIFICATIONS_PATH = '/notificari';

/** The Anunțuri page, named once for the same reason: it carries the unread-announcements badge. */
export const ANNOUNCEMENTS_PATH = '/anunturi';

/** Taskuri, named once: its entry carries the Requests-to-decide badge (#972). */
export const TRACKER_PATH = '/tracker';

/**
 * Profil, named once: on a phone it is reached only from the avatar in the
 * top bar (#972), as Notificări only from the bell, so the shell leaves both
 * out of the bar.
 */
export const PROFILE_PATH = '/profil';
export const ADMIN_PATH = '/administrare';

/**
 * One list drives the sidebar, the mobile tab bar and the page title, so those
 * three can never disagree about what exists or what it is called.
 *
 * Paths are Romanian because members read them; the identifiers around them
 * stay English (CONTEXT.md).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Acasă', icon: LayoutDashboard },
  {
    path: '/tracker',
    label: 'Taskuri',
    icon: ListTodo,
    // A member's history below it is Clasament's page (#844, D17). Its Cereri
    // view (`?vedere=cereri`, #973) is this page too: only the path is matched.
    activeOn: ['/tracker'],
  },
  {
    path: '/clasament',
    label: 'Clasament',
    icon: Trophy,
    capability: 'seeLeadership',
    activeOn: ['/clasament', '/tracker/membru/:id'],
  },
  // Directly under Clasament: the two pages about the members themselves (#910).
  {
    path: '/voluntari',
    label: 'Voluntari',
    icon: Users,
    capability: 'seeDirectory',
  },
  // Its own icon, not Voluntari's: side by side the two must read apart (#972).
  { path: '/grupuri', label: 'Grupuri', icon: Network },
  {
    path: '/administrare/campanii',
    label: 'Campanii',
    icon: Tag,
    capability: 'manageTasks',
    activeOn: [
      '/administrare/campanii/*',
      '/administrare/grupuri/:groupId/campanii/*',
    ],
  },
  {
    path: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
  },
  {
    path: ANNOUNCEMENTS_PATH,
    label: 'Anunțuri',
    icon: Megaphone,
  },
  { path: NOTIFICATIONS_PATH, label: 'Notificări', icon: Bell },
  { path: PROFILE_PATH, label: 'Profil', icon: UserRound },
  {
    path: ADMIN_PATH,
    label: 'Administrare',
    icon: ShieldCheck,
    capability: 'administer',
    // The area's tabs and the Group and Member pages below them — never the
    // Campaign pages, which are Campanii's.
    activeOn: [
      '/administrare',
      '/administrare/membri/*',
      '/administrare/grupuri',
      '/administrare/grupuri/:groupId',
      '/administrare/roluri',
      '/administrare/cereri',
      '/administrare/evaluari',
      '/administrare/perioade',
      '/administrare/confidentialitate',
      '/administrare/setari',
      '/administrare/deals',
      '/administrare/bc',
    ],
  },
];

/**
 * Whether the item is the current page's: one of its `activeOn` patterns
 * matches the whole path, or — without them — the path is the item's own or
 * below it (`/` only on itself). The sidebar, the tab bar and the page title
 * all ask here.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.activeOn)
    return item.activeOn.some(
      (pattern) => matchPath({ path: pattern, end: true }, pathname) !== null,
    );
  if (item.path === '/') return pathname === '/';
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

/**
 * The phone bar's three places, in order: Acasă, then the two things a
 * volunteer opens the app for. Everything else is one tap further, in the
 * bar's Mai mult drawer; Notificări and Profil live in the top bar.
 */
export const TAB_ORDER = ['/', TRACKER_PATH, '/calendar'];

/**
 * What one viewer's navigation holds, decided once so the bar and its drawer
 * cannot disagree: `visible`, every entry they may open (the desktop
 * sidebar); `tabs`, the phone bar's three; and `more`, the entries a phone
 * shows on neither the bar nor the top bar — the Mai mult drawer lists them,
 * everyone's pages (Grupuri, Anunțuri) before the ones a capability gives.
 */
export function navFor(capabilities: Capabilities | undefined): {
  visible: NavItem[];
  tabs: NavItem[];
  more: NavItem[];
} {
  const visible = NAV_ITEMS.filter(
    (item) => !item.capability || capabilities?.[item.capability] === true,
  );
  const tabs = TAB_ORDER.map((path) =>
    visible.find((item) => item.path === path),
  ).filter((item) => item !== undefined);
  const rest = visible.filter(
    (item) =>
      !tabs.includes(item) &&
      item.path !== NOTIFICATIONS_PATH &&
      item.path !== PROFILE_PATH,
  );
  const more = [
    ...rest.filter((item) => !item.capability),
    ...rest.filter((item) => item.capability),
  ];
  return { visible, tabs, more };
}
