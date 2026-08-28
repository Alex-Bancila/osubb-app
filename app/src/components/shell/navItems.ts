import {
  calendarOutline,
  gridOutline,
  listOutline,
  megaphoneOutline,
  peopleOutline,
  personOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import type { Capability } from '../../lib/capabilities';

export type NavItem = {
  path: string;
  /** Sidebar label and, when the item is on the tab bar, the tab caption. */
  label: string;
  icon: string;
  /** Shown to everyone when absent; otherwise gated on this level threshold. */
  capability?: Capability;
  /** Mobile shows five of these; the rest live in the drawer. */
  onTabBar?: boolean;
};

/**
 * One list drives the sidebar, the mobile tab bar and the page title, so those
 * three can never disagree about what exists or what it is called.
 *
 * Paths are Romanian because members read them; the identifiers around them
 * stay English (CONTEXT.md).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Acasă', icon: gridOutline, onTabBar: true },
  { path: '/tracker', label: 'Taskuri', icon: listOutline, onTabBar: true },
  {
    path: '/calendar',
    label: 'Calendar',
    icon: calendarOutline,
    onTabBar: true,
  },
  {
    path: '/anunturi',
    label: 'Anunțuri',
    icon: megaphoneOutline,
    onTabBar: true,
  },
  {
    path: '/voluntari',
    label: 'Voluntari',
    icon: peopleOutline,
    capability: 'seeDirectory',
  },
  { path: '/profil', label: 'Profil', icon: personOutline, onTabBar: true },
  {
    path: '/bc',
    label: 'Panou BC',
    icon: shieldCheckmarkOutline,
    capability: 'manageRoles',
  },
];

/* The mobile bar carries five, in a different order from the sidebar:
   the two things people open the app for come first. */
export const TAB_ORDER = ['/', '/calendar', '/tracker', '/anunturi', '/profil'];
