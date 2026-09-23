import type { MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';

/** A server capability grants global writers every active Origin; otherwise only managed paths and the root. */
export function announcementOrigins(
  groups: readonly Group[],
  roles: readonly MyGroup[],
  globalWriter: boolean,
): Group[] {
  const holdsGroupRole = roles.some(
    (group) =>
      group.group_role === 'manager' || group.group_role === 'responsible',
  );
  const managedIds = new Set(
    roles
      .filter(
        (group) =>
          group.group_role === 'manager' || group.group_role === 'responsible',
      )
      .map((group) => group.id),
  );
  return groups
    .filter(
      (group) =>
        group.status === 'active' &&
        (globalWriter ||
          managedIds.has(group.id) ||
          (group.is_organization && holdsGroupRole)),
    )
    .sort(
      (left, right) =>
        Number(right.is_organization) - Number(left.is_organization) ||
        left.name.localeCompare(right.name, 'ro'),
    );
}
