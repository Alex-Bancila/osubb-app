-- 20260823140923_require_membership_policies.sql
-- OSUBB backend — Epic 3.2e: every policy requires org claims.
-- Source of truth: spec §4.3 + ADR-0003 (gate 2). Tested by the claimless
-- sweep in supabase/tests/rls_deny_by_default.test.sql and by the claimless
-- blocks in the per-role suites.
--
-- THE RULE: a policy on `authenticated` must be unsatisfiable without org
-- claims — either through a level check that cannot pass without them
-- (auth_level() >= N), or explicitly via auth_is_member().
--
-- WHY THIS MIGRATION EXISTS: `to authenticated` was mistaken for "a member".
-- It only excludes anon. A session can be authenticated with NO claims —
-- never invited, or deactivated since its token was issued — and for it
-- auth_level() reads 0 (same as a recrut) while auth.uid() is still a real
-- id. An audit of all 26 policies found 12 satisfiable that way:
--
--   * task_read           — `or status = 'open'` is a bare row predicate
--   * assignee_read       — its subquery inherits task_read
--   * assignee_claim_open — WORST: a deactivated member could join an open,
--                           already-graded task, and the SECURITY DEFINER
--                           ledger trigger would award them the points
--   * request_create      — no membership predicate at all
--   * 8 × `using (true)`  — the reference lookups and membership maps
--
-- NOTE auth.uid() does NOT satisfy the rule: a deactivated member keeps their
-- uid and their profiles row. ledger_read and request_read leak nothing to a
-- stranger, but they are gated below anyway so that losing `activ` status
-- uniformly means losing access (ADR-0003; ADR-0006 retains history, not
-- access).

-- ==================== tasks & points ====================
alter policy task_read on tasks using (
  auth_is_member() and (
       auth_level() >= 4
    or status = 'open'
    or auth_in_dept(dept_id)
    or (team_id is not null and auth_in_team(team_id))
    or is_assigned(id)
  )
);

alter policy assignee_read on task_assignees using (
  auth_is_member()
  and exists (select 1 from tasks t where t.id = task_assignees.task_id)
);

alter policy assignee_claim_open on task_assignees with check (
  auth_is_member()
  and member_id = auth.uid()
  and exists (select 1 from tasks t where t.id = task_assignees.task_id
                                      and t.status = 'open')
);

alter policy ledger_read on points_ledger using (
  auth_is_member() and (
       member_id = auth.uid()
    or auth_level() >= 6
    or (auth_level() >= 4 and in_my_dept(member_id))
  )
);

alter policy request_read on task_requests using (
  auth_is_member() and (
       from_member = auth.uid()
    or auth_level() >= 6
    or (auth_level() >= 4 and auth_in_dept(dept_id))
  )
);

alter policy request_create on task_requests with check (
  auth_is_member()
  and from_member = auth.uid()
  and status = 'pending'
  and decided_by is null
);

-- ==================== reference data & structure ====================
-- These are readable by any member and were written `using (true)`, which
-- also admitted claimless sessions. Membership is the only thing that
-- changes; members see exactly what they saw before.
alter policy roles_read              on roles              using (auth_is_member());
alter policy departments_read        on departments        using (auth_is_member());
alter policy rating_guide_read       on rating_guide       using (auth_is_member());
alter policy difficulty_guide_read   on difficulty_guide   using (auth_is_member());
alter policy role_capabilities_read  on role_capabilities  using (auth_is_member());
alter policy member_departments_read on member_departments using (auth_is_member());
alter policy team_members_read       on team_members       using (auth_is_member());
alter policy teams_read              on teams              using (auth_is_member());

-- ==================== deliberately unchanged ====================
-- Don't "complete the set" — these already satisfy the rule:
--   task_write, assignee_manage, ledger_award, request_decide,
--   teams_manage, member_departments_manage, team_members_manage,
--   announcements_write, event_write   → gated on auth_level() >= N, which is
--                                        0 without claims, so they fail closed.
--   announcement_reads_self, push/RSVP-style self policies added later
--                                      → see their own migrations; anything
--                                        keyed only on auth.uid() needs the
--                                        gate, anything level-keyed does not.
--   auth_admin_read_* (4)              → scoped `to supabase_auth_admin`, the
--                                        role GoTrue uses to issue tokens.
--                                        PostgREST never becomes it, and
--                                        removing these breaks every login.
--
-- Reviewed, left alone on purpose: teams_read still shows `is_interne` teams
-- to members. A team's existence is not the secret — the AG/Interne sheets
-- are, and those are gated at level >= 6 (issue #66).
