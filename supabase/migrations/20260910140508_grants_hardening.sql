-- #363: close default execute grants on the helper functions, make the
-- leadership views select-only, drop the dead in_my_dept helper, and pin
-- search_path on the JWT helpers (same fix #237 applied to auth_role).

-- 1 · JWT helpers, same bodies, now safe under an empty search_path.
create or replace function public.auth_level()
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'member_level')::int, 0)
$$;

create or replace function public.auth_in_dept(d text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'dept_ids' ? d, false)
$$;

create or replace function public.auth_in_team(t text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'team_ids' ? t, false)
$$;

create or replace function public.auth_is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ? 'member_role', false)
$$;

-- 2 · Execute grants: policies run as the querying role, so authenticated
--     and service_role keep execute; anon and public never needed it.
revoke execute on function public.rating_mult(int)       from public, anon;
revoke execute on function public.auth_level()           from public, anon;
revoke execute on function public.auth_role()            from public, anon;
revoke execute on function public.auth_in_dept(text)     from public, anon;
revoke execute on function public.auth_in_team(text)     from public, anon;
revoke execute on function public.auth_is_member()       from public, anon;
grant execute on function
  public.rating_mult(int),
  public.auth_level(),
  public.auth_role(),
  public.auth_in_dept(text),
  public.auth_in_team(text),
  public.auth_is_member()
to authenticated, service_role;

-- 3 · Views: the blanket table grant from 20260819171628 (and its default
--     privileges) gave these views INSERT/UPDATE/DELETE. profiles_directory
--     is auto-updatable, so that grant was live. Same pattern as my_points.
revoke all on table
  public.member_points,
  public.leaderboard,
  public.dept_cup,
  public.profiles_directory,
  public.profiles_contact
from public, anon, authenticated, service_role;
grant select on table
  public.member_points,
  public.leaderboard,
  public.dept_cup,
  public.profiles_directory,
  public.profiles_contact
to authenticated, service_role;

-- 4 · Dead since 20260910123134 rewrote ledger_read without it.
drop function public.in_my_dept(uuid);
