import type { AdminGroup } from '../../queries/groups-admin';

/**
 * Every rank `invite-member` accepts from its only callers. Since ruling R31
 * (#917) a live BC or Moderator — the level-6 gate the function checks, and
 * the only viewer this dialog is mounted for — may give any rank, BC and
 * Moderator included; `provision_profile` checks the appointer again. The
 * retired level-4 rank is never offered, even where a stale row survives.
 */
export function inviteRankOptions(
  roles: ReadonlyMap<string, { name: string; level: number }> | undefined,
): [string, { name: string; level: number }][] {
  return [...(roles?.entries() ?? [])]
    .filter(([id]) => id !== 'responsabil')
    .sort((a, b) => a[1].level - b[1].level);
}

/**
 * The Groups a new Member of `level` can be appointed to by the roster path
 * `provision_profile` takes: active, filled by Appointment (not Automatic
 * Membership) and open to that rank. The server still decides; this only
 * keeps a sure refusal off the list.
 */
export function inviteGroupOptions(
  groups: readonly AdminGroup[],
  level: number,
): AdminGroup[] {
  return groups
    .filter(
      (group) =>
        group.status === 'active' &&
        !group.automatic_membership &&
        !group.is_organization &&
        group.min_level <= level,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ro'));
}
