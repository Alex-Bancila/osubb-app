import {
  ClipboardCheck,
  Crown,
  Lock,
  Network,
  Settings,
  ShieldCheck,
  Ticket,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capabilities, Capability } from '../../lib/capabilities';

/**
 * One tab of the Administrare area (ruling R27, #825): its route, its label
 * and the server capabilities that open it — any one of them. The layout
 * shows the tab and the router admits the route on the same list, so the tab
 * bar never offers a page the route guard would refuse.
 */
export type AdministrareTab = {
  path: string;
  label: string;
  /** The section's tile in the phone menu. */
  icon: LucideIcon;
  /** Any one of these opens the tab (`my_capabilities()`). */
  capabilities: readonly Capability[];
};

export const ADMINISTRARE_PATH = '/administrare';

/** The Group Applications queue: shown only when it can hold something. */
export const APPLICATIONS_TAB_PATH = '/administrare/cereri';

/** OSUBB Deals' page in Administrare (R44); notifications link here. */
export const DEALS_TAB_PATH = '/administrare/deals';

/** The tabs, in the order Alex listed them (R27), then R44's two. */
export const ADMINISTRARE_TABS = [
  {
    path: '/administrare/membri',
    icon: Users,
    label: 'Membri',
    capabilities: ['manageRoles', 'provisionMembers'],
  },
  {
    path: '/administrare/grupuri',
    icon: Network,
    label: 'Grupuri',
    // Not `administer`: that one also opens the area to the OSUBB Deals
    // team (R44), who hold no Group Role.
    capabilities: ['managesAnyGroup'],
  },
  {
    path: '/administrare/roluri',
    icon: ShieldCheck,
    label: 'Roluri',
    capabilities: ['manageRoles'],
  },
  {
    // "de aderare": the nav's Cereri are Completed-work Requests (B55).
    path: APPLICATIONS_TAB_PATH,
    icon: UserPlus,
    label: 'Cereri de aderare',
    capabilities: ['managesAnyGroup'],
  },
  {
    // Ruling R28: the Perioade tab is Evaluări de rol (#826, #827 rebuild it).
    path: '/administrare/evaluari',
    icon: ClipboardCheck,
    label: 'Evaluări de rol',
    capabilities: ['manageRoles'],
  },
  {
    path: '/administrare/confidentialitate',
    icon: Lock,
    label: 'Confidențialitate',
    capabilities: ['manageRoles'],
  },
  {
    path: '/administrare/setari',
    icon: Settings,
    label: 'Setări',
    capabilities: ['manageRoles'],
  },
  {
    // R44: the team's page — the only tab a Responsabil with nothing else
    // sees. BC and the Moderator see every Deal here too, to delete one the
    // dissolved team left behind.
    path: DEALS_TAB_PATH,
    icon: Ticket,
    label: 'OSUBB Deals',
    capabilities: ['manageDeals', 'manageRoles'],
  },
  {
    // R44: the Moderator's Atribuții, never shown to BC.
    path: '/administrare/bc',
    icon: Crown,
    label: 'Administrare BC',
    capabilities: ['administerBc'],
  },
] as const satisfies readonly AdministrareTab[];

export type AdministrareTabPath = (typeof ADMINISTRARE_TABS)[number]['path'];

/** The tab at `path`; every path in the table has one. */
export function administrareTab(path: AdministrareTabPath): AdministrareTab {
  return ADMINISTRARE_TABS.find((tab) => tab.path === path) as AdministrareTab;
}

/** Whether the viewer may open the tab. */
export function tabAllowed(
  tab: AdministrareTab,
  capabilities: Capabilities | undefined,
): boolean {
  return tab.capabilities.some((name) => capabilities?.[name] === true);
}

/** The tabs this viewer may open, in order. */
export function allowedTabs(
  capabilities: Capabilities | undefined,
): AdministrareTab[] {
  return ADMINISTRARE_TABS.filter((tab) => tabAllowed(tab, capabilities));
}
