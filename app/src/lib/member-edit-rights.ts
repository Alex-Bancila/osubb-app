/**
 * What a viewer may change on one Member, as the server decides it (#944,
 * ruling R31). The member page and the Role panel ask this one predicate so
 * neither offers an edit the database refuses.
 *
 * ⚠️ Not a security control: the database decides again on every write. This
 * mirrors it, and must move with it:
 *
 * - `profile` — the full name, Nickname, join date and the address a re-invite
 *   sends to: `profiles_update_self` admits a live active BC or Moderator on
 *   ANY Profile, a BC's or the Moderator's included (#944), and
 *   `guard_profile_privileged_columns` admits the same viewer on the
 *   privileged columns. Their own Profile too: the self limb holds for them.
 * - `rankAndStatus` — `set_member_role` / `set_member_status`: the same viewer,
 *   never on themselves (R31's replacement is named inside another Member's
 *   save, never as the target).
 * - `deleteAccount` — `delete_member` (#1087, ruling R59): the same viewer, never
 *   on themselves (`private.can_delete_member`). Whether the account may go at
 *   all (its history, the last holder of a rank) is the server's preview to
 *   answer, not this predicate's.
 *
 * `leads` is the viewer's live leadership: `my_capabilities().manage_roles`
 * (live level >= 6 with an `activ` Profile) or, where the page has the roster
 * row instead, an `activ` BC or Moderator. The target's own rank never
 * matters any more — that is the point of #944.
 */
export type MemberEditRights = {
  profile: boolean;
  rankAndStatus: boolean;
  deleteAccount: boolean;
};

export const NO_MEMBER_EDITS: MemberEditRights = {
  profile: false,
  rankAndStatus: false,
  deleteAccount: false,
};

export function memberEditRights(
  viewer: { id: string | undefined; leads: boolean },
  targetId: string | undefined,
): MemberEditRights {
  if (!viewer.leads || !viewer.id || !targetId) return NO_MEMBER_EDITS;
  const other = viewer.id !== targetId;
  return { profile: true, rankAndStatus: other, deleteAccount: other };
}
