import { isMinimumLevel } from '../../lib/minimum-level';
import type { BackLinkState } from '../../components/layout';
import type {
  AdminGroup,
  AppointableMember,
  GroupAuthority,
} from '../../queries/groups-admin';

/**
 * Turning the flat `groups` rows into the tree the panel shows, and the small
 * labels that go with it. Pure functions, so the shape of the tree is tested
 * without rendering anything.
 */

/**
 * Presentation categories (ADR-0009): they label the interface and pre-fill
 * settings. No rule branches on them, and neither does anything here beyond
 * the word on the badge.
 */
export const GROUP_CATEGORIES = [
  { value: 'department', label: 'Departament' },
  { value: 'team', label: 'Echipă' },
  { value: 'project', label: 'Proiect' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  department: 'Departament',
  team: 'Echipă',
  project: 'Proiect',
  organization: 'Organizație',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function groupStatusLabel(status: string): string {
  return status === 'active'
    ? 'Activ'
    : status === 'archived'
      ? 'Arhivat'
      : status;
}

/** A Group Role as this Group names it (ADR-0009 §Group Roles). */
export function groupRoleLabel(
  groupRole: string,
  managerTitle?: string | null,
  positionTitle?: string | null,
): string {
  if (groupRole === 'manager') return managerTitle?.trim() || 'Coordonator';
  if (groupRole === 'responsible')
    return positionTitle?.trim() || 'Responsabil';
  return 'Membru';
}

/**
 * Whether the viewer's Group Role here comes from a Group above (F-17): a
 * Manager or Responsible position their own roster row on this Group does not
 * hold. Being on the roster as a plain member does not make it explicit.
 * Without the roster rows yet, `explicit`/`automatic` decide as before.
 */
export function inheritsGroupRole(
  row: {
    id: number;
    group_role: string;
    explicit: boolean;
    automatic: boolean;
  },
  rosterRows: readonly { group_id: number; group_role: string }[] | undefined,
): boolean {
  if (row.group_role !== 'manager' && row.group_role !== 'responsible')
    return false;
  if (!rosterRows) return !row.explicit && !row.automatic;
  return !rosterRows.some(
    (own) => own.group_id === row.id && own.group_role === row.group_role,
  );
}

export type TreeRow = {
  group: AdminGroup;
  /** 0 for a top-level Group; one more for each ancestor shown above it. */
  depth: number;
  hasChildren: boolean;
};

/**
 * Parents before their children, siblings alphabetically. A Group whose parent
 * the caller cannot read is treated as a root of what they can see, so a
 * Manager's own subtree never disappears because its Department did.
 */
export function buildTree(groups: readonly AdminGroup[]): TreeRow[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const children = new Map<number | null, AdminGroup[]>();
  for (const group of groups) {
    const parent =
      group.parent_id !== null && byId.has(group.parent_id)
        ? group.parent_id
        : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(group);
    children.set(parent, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((left, right) => left.name.localeCompare(right.name, 'ro'));
  const rows: TreeRow[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const group of children.get(parent) ?? []) {
      rows.push({
        group,
        depth,
        hasChildren: (children.get(group.id) ?? []).length > 0,
      });
      walk(group.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/**
 * The rows left after collapsing: a Group is hidden when any ancestor above it
 * is collapsed. `expanded` holds the ids the member opened, so a fresh panel
 * shows the top level only.
 */
export function visibleRows(
  rows: readonly TreeRow[],
  expanded: ReadonlySet<number>,
): TreeRow[] {
  const visible: TreeRow[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
    hiddenBelow = null;
    visible.push(row);
    if (row.hasChildren && !expanded.has(row.group.id)) hiddenBelow = row.depth;
  }
  return visible;
}

/** Every id with children, so "Extinde tot" is one state change. */
export function expandableIds(rows: readonly TreeRow[]): number[] {
  return rows.filter((row) => row.hasChildren).map((row) => row.group.id);
}

/** Root-first ancestor names for the breadcrumb, the Group itself included. */
export function groupPathNames(
  group: Pick<AdminGroup, 'path'>,
  byId: ReadonlyMap<number, Pick<AdminGroup, 'id' | 'name'>>,
): { id: number; name: string }[] {
  return group.path.flatMap((id) => {
    const ancestor = byId.get(id);
    return ancestor ? [{ id: ancestor.id, name: ancestor.name }] : [];
  });
}

/**
 * The Minimum Levels a caller may choose for this Group: at least the parent's
 * (`group_min_level_below_parent`) and never above their own
 * (`group_min_level_above_actor`), and only a rung of the Minimum Level ladder
 * (ruling R29b: never the Moderator's 9). The UI stops the mistake; the server
 * still decides.
 */
export function minLevelChoices(
  levels: readonly number[],
  parentMinLevel: number,
  actorLevel: number,
): number[] {
  return [...new Set(levels)]
    .filter(
      (level) =>
        isMinimumLevel(level) && level >= parentMinLevel && level <= actorLevel,
    )
    .sort((left, right) => left - right);
}

/**
 * Who a raised Minimum Level would remove (ruling R23). The form lists them
 * and asks before it sends `p_confirm_removals`, so a stale form can never
 * remove anyone by accident.
 */
export function membersBelowLevel<T extends { level: number }>(
  roster: readonly T[],
  minLevel: number,
): T[] {
  return roster.filter((entry) => entry.level < minLevel);
}

/** The one line the Grup privat setting carries (ruling R25). */
export const PRIVATE_GROUP_HINT =
  'Vizibil doar membrilor, coordonatorilor de pe traseu și BC. Fără cereri de înscriere; intrarea se face prin adăugare directă.';

/**
 * The Group's unfinished Tasks, where an archive refusal sends its manager
 * (navigation D9): Taskuri → De gestionat, filtered to this Group — the root
 * as **Grup principal** and, below a root, the Group itself as **Subgrup**.
 */
export function unfinishedTasksPath(
  group: Pick<AdminGroup, 'id' | 'path'>,
): string {
  const root = group.path[0] ?? group.id;
  const params = new URLSearchParams({
    lista: 'gestionat',
    grup: String(root),
  });
  if (root !== group.id) params.set('subgrup', String(group.id));
  return `/tracker?${params.toString()}`;
}

/** The Group page's tabs, in their order; each is `?tab=<id>` (navigation D6). */
export const GROUP_TABS = [
  { id: 'setari', label: 'Setări' },
  { id: 'roster', label: 'Roster' },
  { id: 'roluri', label: 'Roluri' },
  { id: 'copii', label: 'Grupuri copil' },
  { id: 'campanii', label: 'Campanii' },
  { id: 'cereri', label: 'Cereri' },
] as const;

export type GroupTabId = (typeof GROUP_TABS)[number]['id'];

/**
 * The tabs a viewer can use on one Group (relevance B49): Setări for whoever
 * edits its settings or structure, Roluri for whoever appoints to a position,
 * Grupuri copil when the Group has Child Groups or the viewer may create one,
 * Cereri when the Group takes Applications or still has pending ones. Roster
 * and Campanii are always there.
 */
export function groupTabs(
  authority: Pick<
    GroupAuthority,
    'manageGroup' | 'editStructure' | 'appointManager'
  >,
  facts: {
    hasChildren: boolean;
    canCreateChild: boolean;
    acceptsApplications: boolean;
    pendingApplications: number;
  },
): (typeof GROUP_TABS)[number][] {
  const shown: Record<GroupTabId, boolean> = {
    setari: authority.manageGroup || authority.editStructure,
    roster: true,
    roluri: authority.appointManager || authority.manageGroup,
    copii: facts.hasChildren || facts.canCreateChild,
    campanii: true,
    cereri: facts.acceptsApplications || facts.pendingApplications > 0,
  };
  return GROUP_TABS.filter((tab) => shown[tab.id]);
}

/**
 * The tab `?tab=` names when it is one the viewer can use; otherwise the
 * first they can (an unknown or hidden value is ignored, never an error).
 */
export function currentGroupTab(
  requested: string | null,
  tabs: readonly { id: GroupTabId }[],
): GroupTabId {
  return (
    tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? 'roster'
  );
}

/**
 * Whether a column says anything: at least two different values across the
 * rows (relevance B48). A column where every row reads "Recrut" is noise.
 */
export function varies<T>(rows: readonly T[], value: (row: T) => unknown) {
  const seen = new Set(rows.map(value));
  return seen.size > 1;
}

/**
 * The `state` a Roster name passes to the member page, so its back link
 * returns to this Group's Roster (navigation D4) rather than to a Membri tab
 * the viewer may not be able to open.
 */
export function rosterBackState(groupId: number): BackLinkState {
  return {
    from: {
      to: `/administrare/grupuri/${groupId}?tab=roster`,
      label: 'Înapoi la grup',
    },
  };
}

/** Ranks the position pickers never offer (Alex, 2026-09-29, F-27). */
const OUTSIDE_POSITIONS: ReadonlySet<string> = new Set(['bc', 'moderator']);

/**
 * Who the Coordonator and Responsabil pickers offer (F-27), one rule for
 * both: a live active Member at or above the Group's Minimum Level, not BC or
 * the Moderator, who holds no position here yet — on this roster or
 * inherited from a Group above. The Roster's add picker keeps its own list.
 */
export function positionCandidates(
  members: readonly AppointableMember[],
  group: Pick<AdminGroup, 'min_level'>,
  holders: ReadonlySet<string>,
): AppointableMember[] {
  return members.filter(
    (member) =>
      member.status === 'activ' &&
      member.level >= group.min_level &&
      !OUTSIDE_POSITIONS.has(member.roleId ?? '') &&
      !holders.has(member.memberId),
  );
}
