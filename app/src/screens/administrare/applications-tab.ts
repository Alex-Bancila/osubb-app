import { useMemo } from 'react';
import type { Capabilities } from '../../lib/capabilities';
import { useManagedGroupApplications } from '../../queries/group-applications';
import {
  useAdminGroups,
  useMyGroupRoles,
  type AdminGroup,
} from '../../queries/groups-admin';
import type { MyGroup } from '../../queries/my-groups';
import { groupRoleLabel, inheritsGroupRole } from './group-tree';

/**
 * Whether the Cereri de aderare tab can hold anything for this viewer
 * (relevance B55): a Group they manage takes Applications, or an Application
 * is still waiting on one of their Groups (filed before Applications were
 * turned off). A Group they manage is any Group for BC and the Moderator, and
 * otherwise a Group where they hold a Group Role, here or inherited.
 */
export function applicationsTabShown({
  createTopLevelGroups,
  groups,
  myGroups,
  pending,
}: {
  createTopLevelGroups: boolean;
  groups: readonly Pick<AdminGroup, 'id' | 'accepts_applications' | 'status'>[];
  myGroups: readonly Pick<MyGroup, 'id' | 'group_role'>[];
  pending: number;
}): boolean {
  if (pending > 0) return true;
  const managed = new Set(
    myGroups
      .filter((group) => group.group_role !== 'member')
      .map((group) => group.id),
  );
  return groups.some(
    (group) =>
      group.accepts_applications &&
      group.status === 'active' &&
      (createTopLevelGroups || managed.has(group.id)),
  );
}

/**
 * `applicationsTabShown` over the live reads; `undefined` until they answer,
 * so the tab bar never shows the tab and then takes it away.
 */
export function useApplicationsTabShown(
  capabilities: Capabilities | undefined,
): boolean | undefined {
  const groups = useAdminGroups();
  const myGroups = useMyGroupRoles();
  const applications = useManagedGroupApplications();
  return useMemo(() => {
    // A failed read hides nothing: the tab says what it could not load.
    if (groups.isError || myGroups.isError || applications.isError) return true;
    if (!capabilities || !groups.data || !myGroups.data || !applications.data)
      return undefined;
    return applicationsTabShown({
      createTopLevelGroups: capabilities.createTopLevelGroups,
      groups: groups.data,
      myGroups: myGroups.data,
      pending: applications.data.length,
    });
  }, [
    capabilities,
    groups.data,
    groups.isError,
    myGroups.data,
    myGroups.isError,
    applications.data,
    applications.isError,
  ]);
}

/** One Group of the Cereri de aderare list (#922). */
export type ApplicationGroup = {
  id: number;
  name: string;
  /** The parent's name, for a subgroup whose parent the viewer can read. */
  parentName: string | null;
  color: string | null;
  /** The viewer's Group Role here, as the Group names it; null for none. */
  roleLabel: string | null;
  /** The role comes from a Group above (Manager/Responsible flow down). */
  inherited: boolean;
  /** Pending Applications the viewer may decide here; 0 is kept. */
  pending: number;
};

type ApplicationGroupRow = Pick<
  AdminGroup,
  | 'id'
  | 'name'
  | 'color'
  | 'path'
  | 'parent_id'
  | 'manager_title'
  | 'responsible_title'
>;

/** Tree order, as `my_groups()` sorts: by path, then id. */
function comparePaths(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  for (let i = 0; i < Math.min(left.length, right.length); i += 1)
    if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  return left.length - right.length;
}

/**
 * The Groups the Cereri de aderare page lists (#922), in tree order. The same
 * rule the server decides on (`private.can_manage_group_work`, which both
 * `group_applications_read` and `decide_group_application` apply):
 *
 * - every ACTIVE Group where the viewer is Group Manager or Group Responsible,
 *   here or inherited from an ancestor (`my_groups()`), each with its pending
 *   count — 0 included;
 * - every Group that has a pending Application the viewer may read, which for
 *   BC and the Moderator (who decide on every Group) is every Group with one.
 *
 * Counts come from the queue itself, so a Group never shows a request the
 * viewer cannot open.
 */
export function applicationGroups({
  applications,
  myGroups,
  groups,
  rosterRows,
}: {
  applications: readonly { group_id: number; group: { name: string } }[];
  // `my_groups()` rows; its generated type misses that `color` may be null.
  myGroups: readonly (Pick<
    MyGroup,
    'id' | 'name' | 'path' | 'status' | 'group_role' | 'explicit' | 'automatic'
  > & { color: string | null })[];
  groups: readonly ApplicationGroupRow[];
  rosterRows?: readonly {
    group_id: number;
    group_role: string;
    position_title?: string | null;
  }[];
}): ApplicationGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const pending = new Map<number, number>();
  const names = new Map<number, string>();
  for (const row of applications) {
    pending.set(row.group_id, (pending.get(row.group_id) ?? 0) + 1);
    names.set(row.group_id, row.group.name);
  }
  const listed = new Map<
    number,
    ApplicationGroup & { path: readonly number[] | undefined }
  >();
  const entry = (
    id: number,
    name: string,
    color: string | null,
    path: readonly number[] | undefined,
  ) => {
    const group = byId.get(id);
    const parent =
      group?.parent_id != null ? byId.get(group.parent_id) : undefined;
    return {
      id,
      name,
      parentName: parent?.name ?? null,
      color,
      roleLabel: null,
      inherited: false,
      pending: pending.get(id) ?? 0,
      path,
    };
  };
  for (const mine of myGroups) {
    if (mine.group_role !== 'manager' && mine.group_role !== 'responsible')
      continue;
    if (mine.status !== 'active' && !pending.has(mine.id)) continue;
    const inherited = inheritsGroupRole(mine, rosterRows);
    // The viewer's own title for the position they hold here (#962, #967),
    // as ledTree reads it; one held from above has none on this Group.
    const own = inherited
      ? undefined
      : rosterRows?.find(
          (row) =>
            row.group_id === mine.id && row.group_role === mine.group_role,
        );
    listed.set(mine.id, {
      ...entry(mine.id, mine.name, mine.color, mine.path),
      roleLabel: groupRoleLabel(
        mine.group_role,
        byId.get(mine.id)?.manager_title,
        own?.position_title,
        byId.get(mine.id)?.responsible_title,
      ),
      inherited,
    });
  }
  for (const [id, name] of names) {
    if (listed.has(id)) continue;
    const group = byId.get(id);
    listed.set(
      id,
      entry(id, group?.name ?? name, group?.color ?? null, group?.path),
    );
  }
  return [...listed.values()]
    .sort(
      (left, right) =>
        comparePaths(left.path, right.path) || left.id - right.id,
    )
    .map(({ path: _path, ...group }) => group);
}

/** "1 cerere", "2 cereri", "20 de cereri" — 0 is "0 cereri". */
export function applicationCount(count: number): string {
  if (count === 1) return '1 cerere';
  const rest = count % 100;
  // Romanian takes "de" from 20 on, except after 1–19 (101 cereri).
  return count >= 20 && (rest === 0 || rest >= 20)
    ? `${count} de cereri`
    : `${count} cereri`;
}
