import { inTreeOrder, type WorkFilterGroup } from './work-filter';

/**
 * **Grupuri preferate** (`CONTEXT.md`, ruling R43): a BCE, BC or Moderator
 * unselects Groups; an unselected Group sends them no Notification and is
 * left out of the views they open (Taskuri, Calendar, Anunțuri, Clasament)
 * until they ask to see everything. The server owns the rule
 * (`public.my_group_preferences()`); this module draws the tree and turns the
 * member's ticks into the one list `public.set_unselected_groups` stores.
 *
 * Rows are explicit per Group: nothing is inherited when the server reads
 * them. "Unselecting a Group unselects its subgroups" happens here, by
 * writing the subtree; a subgroup can still be unselected on its own.
 */

/** Why a Group cannot be unselected (the server's `locked`). */
export type GroupPreferenceLock =
  'organization' | 'adunarea_generala' | 'board' | 'position';

/** One row of `my_group_preferences()`. */
export type GroupPreferenceRow = {
  group_id: number;
  selected: boolean;
  locked: string | null;
};

/** The one line under a locked Group: why it stays ticked. */
export const LOCK_REASON: Record<GroupPreferenceLock, string> = {
  organization: 'Toată organizația — rămâne mereu.',
  adunarea_generala: 'Adunarea Generală — rămâne mereu.',
  board: 'Biroul de Conducere — rămâne mereu.',
  position: 'Ai o funcție aici — rămâne mereu.',
};

export function lockOf(row: GroupPreferenceRow | undefined) {
  const locked = row?.locked;
  return locked && locked in LOCK_REASON
    ? (locked as GroupPreferenceLock)
    : null;
}

/** The Groups the member muted: unselected, and not locked. */
export function mutedGroupIds(
  rows: readonly GroupPreferenceRow[] | undefined,
): ReadonlySet<number> {
  return new Set(
    (rows ?? []).filter((row) => !row.selected).map((row) => row.group_id),
  );
}

/** A Group the tree draws. */
export type PreferenceGroup = WorkFilterGroup & { color?: string | null };

export type PreferenceNode = {
  group: PreferenceGroup;
  /** How far below its root (0 for a top-level Group). */
  depth: number;
  lock: GroupPreferenceLock | null;
  /** The ids of every unlocked Group at or below this one, itself first when unlocked. */
  subtree: readonly number[];
};

/**
 * The tree, in reading order: every active Group the server answered for,
 * each parent directly before its own children (the Work Filter's order).
 */
export function preferenceTree(
  groups: readonly PreferenceGroup[],
  rows: readonly GroupPreferenceRow[],
): PreferenceNode[] {
  const byId = new Map(rows.map((row) => [row.group_id, row]));
  const shown = inTreeOrder(
    groups.filter((group) => group.status === 'active' && byId.has(group.id)),
    groups,
  );
  const shownIds = new Set(shown.map((group) => group.id));
  return shown.map((group) => {
    const lock = lockOf(byId.get(group.id));
    const subtree = shown
      .filter(
        (other) => other.path.includes(group.id) && !lockOf(byId.get(other.id)),
      )
      .map((other) => other.id);
    // The visible ancestors only: a Group under a hidden one starts its own level.
    const depth = group.path.filter(
      (id) => id !== group.id && shownIds.has(id),
    ).length;
    return { group, depth, lock, subtree };
  });
}

/** The ticks the sheet opens with: the Groups now unselected. */
export function initialDraft(
  rows: readonly GroupPreferenceRow[],
): ReadonlySet<number> {
  return new Set(
    rows
      .filter((row) => !row.selected && !row.locked)
      .map((row) => row.group_id),
  );
}

export type TickState = 'checked' | 'unchecked' | 'mixed';

/**
 * A Group's box: ticked when it and every unlocked Group below it are
 * selected, empty when all are unselected, mixed otherwise. A locked Group is
 * always ticked; locked Groups below one never make it mixed.
 */
export function tickState(
  node: PreferenceNode,
  unselected: ReadonlySet<number>,
): TickState {
  if (node.lock) return 'checked';
  const off = node.subtree.filter((id) => unselected.has(id)).length;
  if (off === 0) return 'checked';
  return off === node.subtree.length ? 'unchecked' : 'mixed';
}

/**
 * A click on a Group's box. A ticked Group unselects itself and every
 * unlocked Group below it; an empty or mixed one selects them all again.
 * A locked Group does not move.
 */
export function toggleNode(
  node: PreferenceNode,
  unselected: ReadonlySet<number>,
): ReadonlySet<number> {
  if (node.lock) return unselected;
  const next = new Set(unselected);
  if (tickState(node, unselected) === 'checked')
    for (const id of node.subtree) next.add(id);
  else for (const id of node.subtree) next.delete(id);
  return next;
}

/** **Deselectează tot**: every unlocked Group the tree shows, unselected. */
export function unselectAll(
  nodes: readonly PreferenceNode[],
): ReadonlySet<number> {
  return new Set(
    nodes.filter((node) => !node.lock).map((node) => node.group.id),
  );
}

/**
 * What the save sends: the draft, ascending. Groups the tree does not draw
 * (an archived one) keep whatever they had, because the draft started from
 * the server's answer.
 */
export function unselectedPayload(unselected: ReadonlySet<number>): number[] {
  return [...unselected].sort((a, b) => a - b);
}

/** "12 din 18 grupuri": the selected Groups among those the tree draws. */
export function selectedSummary(
  nodes: readonly PreferenceNode[],
  unselected: ReadonlySet<number>,
): { selected: number; total: number } {
  const total = nodes.length;
  const off = nodes.filter(
    (node) => !node.lock && unselected.has(node.group.id),
  ).length;
  return { selected: total - off, total };
}

export function summaryText({
  selected,
  total,
}: {
  selected: number;
  total: number;
}): string {
  if (selected === total && total > 1) return `Toate cele ${total} grupuri`;
  return `${selected} din ${total} ${total === 1 ? 'grup' : 'grupuri'}`;
}

/** Folded, so "Educatie" finds "Educație". */
function folded(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro-RO');
}

/**
 * The search: the Groups whose name holds the text, with every Group above
 * them so each match keeps its place in the tree. Empty text shows all.
 */
export function searchTree(
  nodes: readonly PreferenceNode[],
  text: string,
): PreferenceNode[] {
  const needle = folded(text.trim());
  if (!needle) return [...nodes];
  const keep = new Set<number>();
  for (const node of nodes)
    if (folded(node.group.name).includes(needle))
      for (const id of node.group.path) keep.add(id);
  return nodes.filter((node) => keep.has(node.group.id));
}

/** The part of a Task row the preferred view reads. */
export type PreferredTaskRow = {
  group_id: number;
  assignments?: readonly { member_id: string; ended_at: string | null }[];
  visibleExecutor?: { memberId: string; isCurrent?: boolean } | null;
};

/**
 * Whether the member executes the Task now: their own work is never left
 * out of a view (R43), whatever its Group.
 */
export function executesTask(
  task: PreferredTaskRow,
  memberId: string | undefined,
): boolean {
  if (!memberId) return false;
  if (
    task.visibleExecutor?.memberId === memberId &&
    task.visibleExecutor.isCurrent !== false
  )
    return true;
  return (task.assignments ?? []).some(
    (assignment) =>
      assignment.member_id === memberId && assignment.ended_at === null,
  );
}
