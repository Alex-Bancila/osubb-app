import {
  Bell,
  CalendarDays,
  Trophy,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { matchPath } from 'react-router';
import type { Capability } from '../../lib/capabilities';

export type NavItem = {
  path: string;
  /** Sidebar label and, when the item is on the tab bar, the tab caption. */
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
  /** Mobile shows five of these; the rest live in the drawer. */
  onTabBar?: boolean;
};

/**
 * The Notification centre, named once: the shell needs the path to decide
 * which entry carries the unread badge, and hard-coding it twice is how the
 * badge ends up on nothing after a rename.
 */
export const NOTIFICATIONS_PATH = '/notificari';

/** The Anunțuri page, named once for the same reason: it carries the unread-announcements badge. */
export const ANNOUNCEMENTS_PATH = '/anunturi';

/**
 * One list drives the sidebar, the mobile tab bar and the page title, so those
 * three can never disagree about what exists or what it is called.
 *
 * Paths are Romanian because members read them; the identifiers around them
 * stay English (CONTEXT.md).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Acasă', icon: LayoutDashboard, onTabBar: true },
  {
    path: '/tracker',
    label: 'Taskuri',
    icon: ListTodo,
    onTabBar: true,
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
  { path: '/grupuri', label: 'Grupuri', icon: Users },
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
    onTabBar: true,
  },
  {
    path: ANNOUNCEMENTS_PATH,
    label: 'Anunțuri',
    icon: Megaphone,
    onTabBar: true,
  },
  { path: NOTIFICATIONS_PATH, label: 'Notificări', icon: Bell },
  { path: '/profil', label: 'Profil', icon: UserRound, onTabBar: true },
  {
    path: '/administrare',
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

/* The mobile bar carries five, in a different order from the sidebar:
   the two things people open the app for come first. */
export const TAB_ORDER = [
  '/',
  '/calendar',
  '/tracker',
  ANNOUNCEMENTS_PATH,
  '/profil',
];
