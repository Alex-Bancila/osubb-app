import { memberRoleLabel } from '../components/member/member-identity';
import { useAuth } from '../lib/auth';
import { useOrgSettings } from './org-settings';
import { useMyProfile } from './profile';
import { boardTitleFrom, useMyGroups, useRoles } from './reference';

/** The board's Minimum Level (#824): below it nobody holds a Board Title. */
const BOARD_LEVEL = 5;

/**
 * How the app names the signed-in Member's own Role (#963) — the shell badge,
 * the Profil chip, the points line on Acasă and Taskuri: their Board Title
 * (CONTEXT.md) when they hold one, the Role name otherwise, and `''` until a
 * Role is known, so nothing blank-but-boxed renders.
 *
 * The title is read the way Profil's "Funcția în OSUBB" reads it (decision
 * D1, #824): the caller's own roster row on the Group `board_group_id` names.
 * The live Profile names the Role before the token does, which can lag a
 * Role change by an hour. Below BCE, and for the Moderator (not a board
 * position, F-7), the setting is never asked for.
 */
export function useMyRoleLabel(): string {
  const { claims } = useAuth();
  const profile = useMyProfile();
  const roles = useRoles();
  const groups = useMyGroups();

  const role = profile.data?.role ?? claims?.member_role;
  const level =
    (role ? roles.data?.get(role)?.level : undefined) ??
    claims?.member_level ??
    0;
  const onBoard = level >= BOARD_LEVEL && role !== 'moderator';
  const settings = useOrgSettings({ enabled: onBoard });

  if (!role) return '';
  const title = onBoard
    ? boardTitleFrom(
        groups.membershipRows,
        settings.data?.get('board_group_id'),
      )
    : null;
  return memberRoleLabel(roles.data?.get(role)?.name ?? role, title);
}
