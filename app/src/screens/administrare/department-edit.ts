import type { GroupCommand } from '../../queries/groups-admin';

export type DepartmentMembership = {
  groupId: number;
  groupRole: 'manager' | 'responsible' | 'member';
};

export type DepartmentPlan =
  | { kind: 'commands'; commands: GroupCommand[] }
  /** The change would cost an Appointment: made from the member page. */
  | { kind: 'blocked'; groupId: number };

/**
 * The Group commands that turn a Member's Departments into `principal`
 * followed by `others` (#992). The principal Department is the earliest
 * joined (ruling R17), and nothing rewrites a join date — so making another
 * Department principal leaves every Department joined before it and joins
 * the ones kept again after it. A Department the Member holds an Appointment
 * in (a BCE's Manager seat) is never left only to be re-joined: that change
 * is `blocked` and belongs on the member page.
 *
 * `current` is in join order and lists Departments only.
 */
export function planDepartmentChange(
  memberId: string,
  current: readonly DepartmentMembership[],
  principal: number | null,
  others: readonly number[],
): DepartmentPlan {
  const desired =
    principal === null
      ? []
      : [principal, ...others.filter((id) => id !== principal)];
  const wanted = new Set(desired);
  const held = new Set(current.map((row) => row.groupId));
  const remove = (groupId: number): GroupCommand => ({
    kind: 'removeMember',
    groupId,
    memberId,
  });
  const add = (groupId: number): GroupCommand => ({
    kind: 'addMember',
    groupId,
    memberId,
  });

  // Everything joined before the new principal must go and, if kept, come back.
  const principalAt =
    principal === null
      ? -1
      : current.findIndex((row) => row.groupId === principal);
  const before =
    principal === null || current[0]?.groupId === principal
      ? []
      : principalAt === -1
        ? current
        : current.slice(0, principalAt);
  const cycled = before.filter((row) => wanted.has(row.groupId));
  const appointed = cycled.find((row) => row.groupRole !== 'member');
  if (appointed) return { kind: 'blocked', groupId: appointed.groupId };

  const commands: GroupCommand[] = [];
  for (const row of before) commands.push(remove(row.groupId));
  if (principal !== null && !held.has(principal)) commands.push(add(principal));
  const cycledIds = new Set(cycled.map((row) => row.groupId));
  for (const id of desired.slice(1))
    if (!held.has(id) || cycledIds.has(id)) commands.push(add(id));
  const beforeIds = new Set(before.map((row) => row.groupId));
  for (const row of current)
    if (!wanted.has(row.groupId) && !beforeIds.has(row.groupId))
      commands.push(remove(row.groupId));
  return { kind: 'commands', commands };
}
