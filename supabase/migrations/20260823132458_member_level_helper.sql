-- 20260823132458_member_level_helper.sql
-- OSUBB backend — Epic 2.3b support: authoritative level lookup for server code.
-- Tested by supabase/tests/member_level.test.sql.
--
-- The auth_*() helpers read the caller's JWT, which is right for RLS but
-- useless inside an Edge Function acting with the service key: there is no
-- caller JWT in that session. Server-side admin actions (invite #57, CSV
-- import #72) must therefore ask the database directly.
--
-- Reading the level from the DATABASE rather than from the caller's token is
-- also the safer choice for actions that create accounts: a token issued
-- before a demotion still carries the old level until it expires.
--
-- Returns 0 — the level of a recrut, and of a stranger — for anyone who is
-- missing, inactive or unprovisioned, so callers can simply compare against a
-- threshold and never special-case null.

create or replace function member_level(p_member uuid) returns int
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select r.level
       from public.profiles p
       join public.roles r on r.id = p.role
      where p.id = p_member and p.status = 'activ'),
    0);
$$;

comment on function member_level(uuid) is
  'Level of an active member, 0 if missing/inactive. For server-side authorization (Edge Functions); RLS policies use auth_level() instead.';

revoke execute on function member_level(uuid) from public, anon, authenticated;
grant execute on function member_level(uuid) to service_role;
