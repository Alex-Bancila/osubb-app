-- 20260822230203_event_policies.sql
-- OSUBB backend — Epic 3.4a: calendar visibility.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.4)
-- Tested by supabase/tests/rls_events.test.sql.
--
-- This single policy is the mockup's OSUBB.eventVisible() moved to the one
-- place it cannot be bypassed. Five ways an event can be visible to you:
--   1. you manage the calendar (level >= 4, capability seeAllEvents);
--   2. it is org-scoped, or its type is a call / recruitment — those are
--      announcements by nature and reach everybody;
--   3. it belongs to a department you are in;
--   4. it belongs to a team you are in — or, if you are a recrut, to a team
--      that recruits may see (teams.for_recruits);
--   5. it has a department but no team, and you are in that department.
--
-- Everything is wrapped in auth_is_member(): without it, branch 2 would show
-- every org-wide event to a session that authenticated but carries no org
-- claims (ADR-0003 gate 2).

-- Recruit-visible team lookup as a definer helper, matching the 3.3 pattern
-- (is_assigned / in_my_dept): a policy should not depend on another table's
-- policies, or a future narrowing of `teams` would silently change who can
-- see which events.
create or replace function team_admits_recruits(t text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.teams tm
                  where tm.id = t and tm.for_recruits);
$$;

revoke execute on function team_admits_recruits(text) from public, anon;
grant execute on function team_admits_recruits(text) to authenticated;

create policy event_read on events for select to authenticated using (
  auth_is_member() and (
       auth_level() >= 4
    or scope = 'org'
    or type in ('call', 'recrutare')
    or (scope = 'dept' and auth_in_dept(dept_id))
    or (team_id is not null and (
          auth_in_team(team_id)
          or (auth_role() = 'recrut' and team_admits_recruits(team_id))))
    or (team_id is null and auth_in_dept(dept_id))
  )
);

-- Create / edit / cancel: level >= 4 (capability manageTasks' calendar twin).
create policy event_write on events for all to authenticated
  using (auth_level() >= 4) with check (auth_level() >= 4);
