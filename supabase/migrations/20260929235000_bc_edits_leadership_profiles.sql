-- #944 (ruling R31 follow-up): a BC member edits a BC's or the Moderator's
-- Profile fields, as the Moderator does.
--
-- Why: R31 (#905, #917) gave every BC member the Moderator's authority over the
-- BC and Moderator ranks, their Status, and provisioning or re-inviting an
-- account at either rank. The Profile fields on those same accounts (full
-- name, Nickname, join date, email, tier) stayed the Moderator's alone: the
-- security pass M4 (20260927180000_live_level_gates.sql) kept a BC to Profiles
-- below level 6 because profiles.email is what invite-member, reinvite-member
-- and the bounce mapping read, and a BC rewriting a leadership address
-- undercut the then Moderator-only rule on appointments. R31 retired that rule,
-- so the limit now only refuses a BC an edit the member page offers (found by
-- CodeRabbit on #940).
--
-- What changes: the BC limb of profiles_update_self no longer reads the
-- target's level. A live active BC or Moderator (private.caller_level() >= 6)
-- edits any Profile; the separate Moderator limb (>= 9) is subsumed by it.
--
-- What does not change:
--   * The self limb: a live active Member edits their own Profile; which
--     columns is still guard_profile_privileged_columns' call (full_name,
--     email, tier, joined_year, joined_at are BC's), unchanged.
--   * Rank and Status: `update (role, status)` stays revoked from
--     authenticated (#610, 20260926092000_profile_command_writes.sql), so this
--     path never re-ranks or deactivates anyone; set_member_role and
--     set_member_status remain the only client writes, with their own
--     never-on-yourself and last-holder rules.
--   * The live level: the gate reads the Profile, never the token (M4), and
--     auth_is_member() stays in front as the claims guard (house rule 12).
--
-- Rebuilt from main's latest profiles_update_self, 20260927180000_live_level_gates.sql,
-- with only the BC limb changed.

alter policy profiles_update_self on public.profiles
  using (
    public.auth_is_member()
    and (
      (id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or (select private.caller_level()) >= 6
    )
  )
  with check (
    public.auth_is_member()
    and (
      (id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or (select private.caller_level()) >= 6
    )
  );

comment on policy profiles_update_self on public.profiles is
  'A live active Member edits their own Profile; a live BC or Moderator (level >= 6) edits any Profile, a BC''s or the Moderator''s included (ruling R31, #944). Levels are read from the live Profile (private.caller_level), never from the token. Privileged columns are further limited by guard_profile_privileged_columns; role and status are not client-writable at all (#610) -- set_member_role and set_member_status own them.';
