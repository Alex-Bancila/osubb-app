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

/**
 * A Group Role as this Group names it (ADR-0009 §Group Roles): a Manager by
 * the Group's Manager title, a Responsible by their own title, then by the
 * Group's name for the position (#962).
 */
export function groupRoleLabel(
  groupRole: string,
  managerTitle?: string | null,
  positionTitle?: string | null,
  responsibleTitle?: string | null,
): string {
  if (groupRole === 'manager') return managerTitle?.trim() || 'Coordonator';
  if (groupRole === 'responsible')
    return positionTitle?.trim() || responsibleTitle?.trim() || 'Responsabil';
  return 'Membru';
}

/**
 * A position's name inside a sentence ("Numește un coordonator", #962): each
 * capitalised word in lower case, an acronym (BCE, IT) as written.
 */
export function positionNoun(title: string): string {
  return title
    .trim()
    .split(/(\s+)/)
    .map((word) =>
      /^\p{Lu}[\p{Ll}-]*$/u.test(word) ? word.toLocaleLowerCase('ro') : word,
    )
    .join('');
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
  /** The Group shown above it, for the "subgrup al …" label; null at the top. */
  parentName: string | null;
  /** Whether it is the last of its siblings: its rail ends in its elbow. */
  last: boolean;
  /**
   * The tree guide's through-lines, one per ancestor rail left of its own
   * elbow (length `depth - 1`): `true` where the ancestor one level down on
   * this row's path still has a sibling below, so that rail runs on.
   */
  continues: boolean[];
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
  const walk = (
    parent: AdminGroup | null,
    depth: number,
    continues: boolean[],
  ) => {
    const siblings = children.get(parent?.id ?? null) ?? [];
    siblings.forEach((group, index) => {
      const last = index === siblings.length - 1;
      rows.push({
        group,
        depth,
        hasChildren: (children.get(group.id) ?? []).length > 0,
        parentName: parent?.name ?? null,
        last,
        continues,
      });
      // A top-level Group draws no elbow, so its children carry no
      // through-line for it; below that, each level adds one.
      walk(group, depth + 1, depth === 0 ? [] : [...continues, !last]);
    });
  };
  walk(null, 0, []);
  return rows;
}

/** A Group Role the viewer holds on a Group, and whether it comes from above. */
export type Lead = {
  groupRole: 'manager' | 'responsible';
  inherited: boolean;
};

/** One row of **Conduse de mine**: a led Group, or a greyed context parent. */
export type LedRow = TreeRow & {
  /** Null for a parent shown only as context for a led Child Group. */
  lead: Lead | null;
};

/** The fields of a `my_groups()` row the led view reads. */
export type LedSource = {
  id: number;
  name: string;
  path: number[];
  group_role: string;
  explicit: boolean;
  automatic: boolean;
  category: string;
  color: string | null;
  min_level: number;
  status: string;
  is_organization: boolean;
};

/** A led Group the Group rows lack (a read racing an Appointment). */
function fromLedSource(source: LedSource): AdminGroup {
  return {
    id: source.id,
    name: source.name,
    short: null,
    color: source.color || null,
    category: source.category,
    path: source.path,
    parent_id: source.path.length > 1 ? (source.path.at(-2) ?? null) : null,
    min_level: source.min_level,
    status: source.status,
    is_organization: source.is_organization,
    is_private: false,
    manager_title: null,
    responsible_title: null,
    automatic_membership: false,
    accepts_applications: false,
    application_level: null,
    competes_in_cup: false,
    counts_toward_parent_cup: false,
    shared_work_visibility: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 0,
  };
}

/**
 * **Conduse de mine** (#921): the Groups where the viewer holds a Group Role —
 * their own position or one inherited from a Group above (ruling R14) — in
 * tree order, with each led Group's readable ancestors kept as context, so a
 * Child Group never floats without its parent. Plain membership leads
 * nothing (relevance B47).
 */
export function ledTree(
  groups: readonly AdminGroup[],
  mine: readonly LedSource[],
  rosterRows: readonly { group_id: number; group_role: string }[] | undefined,
): LedRow[] {
  const leads = new Map<number, Lead>();
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const row of mine) {
    if (row.group_role !== 'manager' && row.group_role !== 'responsible')
      continue;
    leads.set(row.id, {
      groupRole: row.group_role,
      inherited: inheritsGroupRole(row, rosterRows),
    });
    if (!byId.has(row.id)) byId.set(row.id, fromLedSource(row));
  }
  const shown = new Map<number, AdminGroup>();
  for (const id of leads.keys()) {
    const group = byId.get(id);
    if (!group) continue;
    for (const ancestor of group.path) {
      const found = byId.get(ancestor);
      if (found) shown.set(found.id, found);
    }
    shown.set(group.id, group);
  }
  return buildTree([...shown.values()]).map((row) => ({
    ...row,
    lead: leads.get(row.group.id) ?? null,
  }));
}

/** Whether the viewer holds any Group Role (the **Conduse de mine** test). */
export function leadsAny(mine: readonly { group_role: string }[]): boolean {
  return mine.some(
    (row) => row.group_role === 'manager' || row.group_role === 'responsible',
  );
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

/**
 * Ranks a position picker never offers (Alex, 2026-09-29, F-27; amended
 * 2026-09-30, #957): the Moderator holds no Group position at all, and a BC
 * member — a Department's Vicepreședinte — may be a Group Manager of any
 * Group but never a Group Responsible, the position the BCE members hold.
 */
const OUTSIDE_POSITIONS: Record<
  'manager' | 'responsible',
  ReadonlySet<string>
> = {
  manager: new Set(['moderator']),
  responsible: new Set(['bc', 'moderator']),
};

/**
 * Who the Coordonator or the Responsabil picker offers (F-27, #957): a live
 * active Member at or above the Group's Minimum Level, not of a rank kept
 * outside that position, who holds no position here yet — on this roster or
 * inherited from a Group above. The Roster's add picker keeps its own list.
 */
export function positionCandidates(
  members: readonly AppointableMember[],
  group: Pick<AdminGroup, 'min_level'>,
  holders: ReadonlySet<string>,
  position: 'manager' | 'responsible',
): AppointableMember[] {
  const outside = OUTSIDE_POSITIONS[position];
  return members.filter(
    (member) =>
      member.status === 'activ' &&
      member.level >= group.min_level &&
      !outside.has(member.roleId ?? '') &&
      !holders.has(member.memberId),
  );
}

/**
 * The direct Manager's title a new Group's category pre-fills (#951), the
 * titles the Groups of that category carry: Vicepreședinte for a Department
 * (#957 — its Manager is a BC member; the BCE members are its Responsabili),
 * Coordonator Principal for a Project, Coordonator for a Team.
 */
const MANAGER_TITLES: Record<string, string> = {
  department: 'Vicepreședinte',
  project: 'Coordonator Principal',
  team: 'Coordonator',
};

export function managerTitleFor(category: string): string {
  return MANAGER_TITLES[category] ?? 'Coordonator';
}

/**
 * Who a new Group's direct Manager may be (#951): a live active Member at or
 * above the new Group's Minimum Level — what `create_group` accepts — and
 * never the Moderator. BC is offered like anyone eligible, the creator too.
 */
export function directManagerCandidates(
  members: readonly AppointableMember[],
  minLevel: number,
): AppointableMember[] {
  return members.filter(
    (member) =>
      member.status === 'activ' &&
      member.level >= minLevel &&
      member.roleId !== 'moderator',
  );
}

/**
 * Who a created Group's receipt names (#951): the direct Manager appointed
 * with it and the title they hold, or `null` when none was chosen.
 */
export function createdGroupManager(
  command: { category: string; managerId: string | null },
  members: readonly AppointableMember[],
): { member: AppointableMember; title: string } | null {
  const member = command.managerId
    ? members.find((candidate) => candidate.memberId === command.managerId)
    : undefined;
  return member ? { member, title: managerTitleFor(command.category) } : null;
}
