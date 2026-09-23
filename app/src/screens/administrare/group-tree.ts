import type { AdminGroup } from '../../queries/groups-admin';

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
 * (`group_min_level_above_actor`). The UI stops the mistake; the server still
 * decides.
 */
export function minLevelChoices(
  levels: readonly number[],
  parentMinLevel: number,
  actorLevel: number,
): number[] {
  return [...new Set(levels)]
    .filter((level) => level >= parentMinLevel && level <= actorLevel)
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
