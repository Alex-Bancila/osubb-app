-- 20260825222808_public_points_totals.sql
-- OSUBB backend — 1.4b: a member's points TOTAL is public inside the org; their
-- ledger is not.
-- Tested by supabase/tests/points_visibility.test.sql.
--
-- The bug this fixes: `member_points` was security_invoker, so it summed only
-- the ledger rows the *caller* may read — and `ledger_read` gives an ordinary
-- member their own rows only. Every derived number therefore collapsed for
-- anyone below level 4. Read over HTTP as the demo accounts:
--
--   leaderboard, as a voluntar        dept_cup, as a voluntar   …as BC
--     Ioana Popescu   12  rank 1        edu    12                 edu    26
--     everyone else    0  rank 2        everything else 0         pr     24, …
--
-- which is the gamification the mandate asks for, showing zero to roughly
-- ninety percent of the organization, and misreporting the cup while it does.
--
-- The rule underneath: a TOTAL is public — that is what a leaderboard is. The
-- ITEMISED history is not: a sanction, its reason and who gave it stay private
-- (spec §4.3, Plan IV.3). So the aggregate crosses the fence and nothing else
-- does. `points_ledger` and every one of its policies are untouched.

-- ==================== member_points ====================
-- ⚠️ Owner rights (security_invoker = off) — the second deliberate exception to
-- house rule 3, after profiles_contact, and for the same reason: this view
-- exists precisely to publish a projection of rows the caller cannot read one
-- by one. That makes its WHERE clause the security boundary rather than a
-- filter, so it carries its own membership gate (house rule 12): without it an
-- owner-rights view would hand every total to a session with no claims at all.
--
-- Nothing else needs to change. `leaderboard` and `dept_cup` stay
-- security_invoker and keep reading profiles / member_departments, whose
-- policies already require membership — so they stay gated while the numbers
-- flowing through them become true.
-- The second half of the gate is the same one the profiles trigger uses (3.2b):
-- server-side callers carry no member_level, and the promotion job (#51/#52)
-- exists precisely to read these totals and decide who has earned the next
-- role. A membership check alone would leave it reading zeroes and promoting
-- nobody — and would break every test that queries this view as the owner.
create or replace view member_points with (security_invoker = off) as
  select p.id as member_id, coalesce(sum(l.delta), 0)::int as points
    from profiles p
    left join points_ledger l on l.member_id = p.id
   where auth_is_member()
      or current_user not in ('authenticated', 'anon')
   group by p.id;

comment on view member_points is
  'Points total per member. Owner rights on purpose (1.4b): totals are public inside the org — the leaderboard and the department cup are built on this — while points_ledger stays row-gated so sanctions and their reasons remain private. The auth_is_member() clause is the security boundary; do not widen it.';
