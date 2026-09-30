import type { DirectoryMember } from '../../queries/member-directory';
import type { Group } from '../../queries/reference';

/**
 * What the directory is narrowed by. Values of one kind widen the result
 * (Group A or Group B); different kinds narrow it (a Group and a role).
 */
export type DirectoryFilters = {
  search: string;
  groupIds: number[];
  roleIds: string[];
  statuses: string[];
};

export const emptyFilters: DirectoryFilters = {
  search: '',
  groupIds: [],
  roleIds: [],
  statuses: [],
};

export const statusLabels: Record<string, string> = {
  activ: 'Activ',
  inactiv: 'Inactiv',
  alumni: 'Alumni',
};

export function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

/** Case- and diacritic-blind, so "stefan" finds "Ștefan". */
export function normalizeSearch(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro');
}

export function matchesFilters(
  member: DirectoryMember,
  filters: DirectoryFilters,
): boolean {
  const search = normalizeSearch(filters.search.trim());
  if (search) {
    const haystack = normalizeSearch(
      [
        member.name,
        member.nickname ?? '',
        member.role,
        // A Board Title names the Role (#963): "BC" still finds its holder.
        member.rankLabel,
        member.contact?.email ?? '',
        ...member.groups.map((group) => group.label),
      ].join(' '),
    );
    if (!haystack.includes(search)) return false;
  }
  // A chosen Group also finds the members of every Group below it.
  if (
    filters.groupIds.length &&
    !filters.groupIds.some((groupId) =>
      member.groups.some((group) => group.path.includes(groupId)),
    )
  )
    return false;
  if (
    filters.roleIds.length &&
    !(member.roleId && filters.roleIds.includes(member.roleId))
  )
    return false;
  if (filters.statuses.length && !filters.statuses.includes(member.status))
    return false;
  return true;
}

/**
 * Which optional columns say something about the directory (B69): Statut
 * only when some member is not active; Contact only when the protected view
 * supplied contact rows (a phone shows under the email only where there is
 * one, never as a column of dashes).
 */
export type DirectoryColumns = {
  withStatus: boolean;
  withContact: boolean;
};

export function directoryColumns(
  members: readonly DirectoryMember[],
): DirectoryColumns {
  return {
    withStatus: members.some((member) => member.status !== 'activ'),
    withContact: members.some((member) => member.contact !== undefined),
  };
}

/**
 * The Grup options (B68): the active Groups at least one listed member is in
 * (directly or through a Group below), without the Organization Group, which
 * holds everyone. The Adunarea Generală is offered and filters to its members
 * by Automatic Membership (#929, ruling R32).
 */
export function directoryGroupOptions(
  groups: Iterable<Group>,
  members: readonly DirectoryMember[],
): Group[] {
  const listed = new Set(
    members.flatMap((member) => member.groups.flatMap((group) => group.path)),
  );
  return [...groups].filter(
    (group) =>
      group.status === 'active' &&
      !group.is_organization &&
      listed.has(group.id),
  );
}

/** Filters shown as chips — the search box speaks for itself. */
export function activeFilterCount(filters: DirectoryFilters) {
  return (
    filters.groupIds.length + filters.roleIds.length + filters.statuses.length
  );
}

export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}
