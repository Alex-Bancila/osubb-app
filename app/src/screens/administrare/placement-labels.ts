import { resolveGroupRoleLabel, type Group } from '../../queries/reference';
import type { Placement } from '../../queries/volunteer-import';

/**
 * A row's Groups as the import screens name them (#992): its Departments in
 * roster order (the first is the principal one, R17) and its positions — a BC
 * title, a Department Manager seat, a Project role — as "Titlu · Grup".
 * A Group the viewer's list does not hold yet (just created) still shows by
 * the name the import sent; it counts as a Department when it is a plain
 * membership, which is all a sheet's Department columns produce.
 */
export function describePlacements(
  placements: readonly Placement[],
  groups: ReadonlyMap<number, Group> | undefined,
): { departments: string[]; positions: string[] } {
  const departments: string[] = [];
  const positions: string[] = [];
  for (const placement of placements) {
    const group = groups?.get(placement.groupId);
    const name = group?.name ?? placement.groupName;
    const isDepartment = group
      ? group.category === 'department'
      : placement.groupRole === 'member';
    if (isDepartment) departments.push(name);
    if (placement.groupRole !== 'member')
      positions.push(
        `${resolveGroupRoleLabel(
          placement.groupRole,
          group?.manager_title,
          placement.positionTitle,
          group?.responsible_title,
        )} · ${name}`,
      );
  }
  return { departments, positions };
}
