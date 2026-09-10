import type { MemberClaims } from './auth';

/**
 * Friendly names for the level thresholds enforced by SQL authorization
 * helpers, RLS policies, and server commands. Keep these UI hints aligned with
 * those security boundaries.
 *
 * ⚠️ Nothing here is a security control. The database decides, from the same
 * claims, on every single row — these exist so the UI can be *kind*: hide a tab
 * nobody can use, disable a button that would only fail. If you ever find
 * yourself reaching for one of these to decide what *data* to show, that logic
 * belongs in a policy, and it probably already exists (mini-spec §1).
 */
export const LEVEL = {
  manageTasks: 4,
  seeAllEvents: 4,
  createTeams: 5,
  /* Mirrors the `profiles_contact` gate, which hands out email and phone at
     level >= 5. The volunteers directory is built on it. */
  seeDirectory: 5,
  /* Mirrors 20260907204817_leadership_only_global_points.sql: leaderboard,
     dept_cup and member_points return rows only at level >= 5. */
  seeLeadership: 5,
  seeAllSheets: 6,
  seeInterne: 6,
  manageRoles: 6,
} as const;

export type Capability = keyof typeof LEVEL;

/** `can(claims, 'manageRoles')` — reads better than a bare `>= 6` in a screen. */
export function can(
  claims: MemberClaims | null,
  capability: Capability,
): boolean {
  return (claims?.member_level ?? 0) >= LEVEL[capability];
}
