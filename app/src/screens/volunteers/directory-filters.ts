import type { DirectoryMember } from '../../queries/member-directory';

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
