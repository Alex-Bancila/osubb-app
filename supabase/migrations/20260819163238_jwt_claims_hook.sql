-- 20260819163238_jwt_claims_hook.sql
-- OSUBB backend — Epic 2.2: custom access-token hook + auth_*() helpers.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.2)
-- Tested by supabase/tests/auth_claims.test.sql.
--
-- The hook copies the member's role, level, department ids and team ids into
-- the JWT at token issue time, so RLS policies (Epic 3) read them from the
-- token instead of re-querying profiles on every row.
--
-- Local: enabled via [auth.hook.custom_access_token] in supabase/config.toml.
-- Hosted (staging/prod): must be enabled once per project in
-- Dashboard → Authentication → Hooks → "Customize Access Token (JWT) Claims"
-- → Postgres function `public.custom_access_token_hook`.

-- ==================== Claims hook ====================
-- Runs as supabase_auth_admin (grants below). Un-provisioned or non-activ
-- members get NO org claims: auth_level() then reads 0 and every RLS policy
-- fails closed (ADR-0003's second gate).
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  member record;
  claims jsonb;
  meta   jsonb;
begin
  select p.role, r.level,
         coalesce((select jsonb_agg(md.dept_id)
                     from public.member_departments md
                    where md.member_id = p.id), '[]'::jsonb) as dept_ids,
         coalesce((select jsonb_agg(tm.team_id)
                     from public.team_members tm
                    where tm.member_id = p.id), '[]'::jsonb) as team_ids
    into member
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = (event ->> 'user_id')::uuid
     and p.status = 'activ';

  if not found then
    return event;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb)
            || jsonb_build_object(
                 'member_role',  member.role,
                 'member_level', member.level,
                 'dept_ids',     member.dept_ids,
                 'team_ids',     member.team_ids);
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{app_metadata}', meta));
end;
$$;

-- Only the Auth server may call the hook.
revoke execute on function custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on profiles, roles, member_departments, team_members to supabase_auth_admin;

-- Dormant until Epic 3.1 enables RLS on these tables — created now so
-- enabling RLS later cannot break token issuance (logins would fail).
create policy auth_admin_read_profiles on profiles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_roles on roles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_member_departments on member_departments
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_team_members on team_members
  for select to supabase_auth_admin using (true);

-- ==================== RLS helper functions (spec §4.2) ====================
-- Plain inlinable SQL so the planner folds them into policy predicates.
-- All read only the JWT — no table access, no per-row queries.

create or replace function auth_level() returns int language sql stable as
$$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'member_level')::int, 0) $$;

create or replace function auth_role() returns member_role language sql stable as
$$ select (auth.jwt() -> 'app_metadata' ->> 'member_role')::member_role $$;

create or replace function auth_in_dept(d text) returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' -> 'dept_ids' ? d, false) $$;

create or replace function auth_in_team(t text) returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' -> 'team_ids' ? t, false) $$;
