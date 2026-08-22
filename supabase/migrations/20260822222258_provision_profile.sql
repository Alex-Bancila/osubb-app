-- 20260822222258_provision_profile.sql
-- OSUBB backend — Epic 2.3a: the one provisioning path.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§5.1)
-- + ADR-0003 (invite-only). Tested by supabase/tests/provision_profile.test.sql.
--
-- Both onboarding routes — the single invite (#57) and the CSV import (#72) —
-- call THIS function, so a member can never be half-created: profile,
-- departments and teams land in one statement or none of them do. The caller
-- (an Edge Function holding the service key) has already created the
-- auth.users row via the Auth admin API.

create or replace function provision_profile(
  p_user_id   uuid,
  p_full_name text,
  p_email     text,
  p_role      member_role default 'recrut',
  p_dept_ids  text[]      default '{}',
  p_team_ids  text[]      default '{}'
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (p_user_id, p_full_name, lower(trim(p_email)), p_role);

  -- Unknown department/team ids raise a foreign-key violation, which aborts
  -- the whole function: no orphan profile survives a typo in a CSV row.
  insert into public.member_departments (member_id, dept_id)
  select p_user_id, d from unnest(coalesce(p_dept_ids, '{}')) as d;

  insert into public.team_members (team_id, member_id)
  select t, p_user_id from unnest(coalesce(p_team_ids, '{}')) as t;

  return p_user_id;
end;
$$;

comment on function provision_profile(uuid, text, text, member_role, text[], text[]) is
  'Atomically provisions an invited auth user: profiles + member_departments + team_members. Service-role only; shared by the single-invite and CSV-import flows (ADR-0003).';

-- Clients must never provision themselves — this runs as its owner and
-- bypasses RLS by design, so execute stays with the server identity only.
revoke execute on function provision_profile(uuid, text, text, member_role, text[], text[])
  from public, anon, authenticated;
grant execute on function provision_profile(uuid, text, text, member_role, text[], text[])
  to service_role;
