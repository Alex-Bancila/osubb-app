import {
  Bell,
  CalendarDays,
  Trophy,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  ClipboardPlus,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '../../lib/capabilities';

export type NavItem = {
  path: string;
  /** Sidebar label and, when the item is on the tab bar, the tab caption. */
  label: string;
  icon: LucideIcon;
  /** Shown to everyone when absent; otherwise gated on this server
   *  capability (`my_capabilities()`, live rank and Group Roles). */
  capability?: Capability;
  /** Active only on this exact path, not on the routes nested below it. */
  exact?: boolean;
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
  { path: '/tracker', label: 'Taskuri', icon: ListTodo, onTabBar: true },
  {
    path: '/clasament',
    label: 'Clasament',
    icon: Trophy,
    capability: 'seeLeadership',
  },
  { path: '/grupuri', label: 'Grupuri', icon: Users },
  { path: '/cereri', label: 'Cereri', icon: ClipboardPlus },
  {
    path: '/administrare/campanii',
    label: 'Campanii',
    icon: Tag,
    capability: 'manageTasks',
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
  {
    path: '/voluntari',
    label: 'Voluntari',
    icon: Users,
    capability: 'seeDirectory',
  },
  { path: '/profil', label: 'Profil', icon: UserRound, onTabBar: true },
  {
    path: '/administrare',
    label: 'Administrare',
    icon: ShieldCheck,
    capability: 'administer',
    exact: true,
  },
];

/* The mobile bar carries five, in a different order from the sidebar:
   the two things people open the app for come first. */
export const TAB_ORDER = [
  '/',
  '/calendar',
  '/tracker',
  ANNOUNCEMENTS_PATH,
  '/profil',
];
