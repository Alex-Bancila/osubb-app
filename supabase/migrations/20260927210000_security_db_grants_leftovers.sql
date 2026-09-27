-- Security pass 2026-09-27, findings I1: the database leftovers.
--
-- 1. public.visible_task_executors takes at most 200 Task ids per call. A
--    longer array is PT400 too_many_ids at step 1, before any row is read.
--    The app sends its ids in batches of 200 (app/src/queries/task-executors.ts).
--    The private body is rebuilt from its latest definition
--    (20260923223833_nickname_member_card.sql). The only change is the cap,
--    which needs plpgsql to raise. The signature, return type, grants and
--    wrapper are unchanged.
--
-- 2. Command-only tables lose their default write grants to authenticated.
--    roles, difficulty_guide and rating_guide are reference data. They change
--    only by migration, so authenticated keeps SELECT and loses INSERT, UPDATE
--    and DELETE. profiles loses table-level INSERT and DELETE. Provisioning is
--    public.provision_profile (security definer, service role only), and no
--    client deletes a Member. The column-level UPDATE grants behind
--    profiles_update_self are untouched. None of the four tables has a write
--    policy for these commands, so no policy becomes dead. Until now RLS was
--    the only thing stopping these writes; the missing grant is now a second
--    guard in front of it.
--
-- 3. pg_graphql is dropped. Nothing in the app or the Edge Functions uses
--    GraphQL. #818 stopped exposing graphql_public (config.toml [api] schemas).
--    When the extension is dropped, Supabase's issue_graphql_placeholder event
--    trigger leaves a stub graphql_public.graphql() that only returns
--    "pg_graphql extension is not enabled". A hosted project can re-enable
--    pg_graphql from the dashboard (Database -> Extensions). Keep it off
--    (docs/backend/auth-config.md).
--
-- Not done here: revoking EXECUTE on net.http_get / net.http_post from anon and
-- authenticated. supabase_admin owns the net schema and granted those
-- privileges, and the migration role (postgres) holds them without grant
-- option. A REVOKE from postgres therefore changes nothing (WARNING: no
-- privileges could be revoked), locally and on hosted projects alike.
-- conventions.test.sql instead pins what we control: no public/private
-- function reaches pg_net, and every cron job that calls net.http_post runs as
-- a role that can execute it.

-- 1. ----------------------------------------------------------------------

create or replace function private.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text,
  nickname text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if cardinality(p_task_ids) > 200 then
    raise sqlstate 'PT400' using
      message = 'too_many_ids',
      detail = 'visible_task_executors: at most 200 Task ids per call';
  end if;

  return query
  select assignment.task_id, assignment.member_id, profile.full_name, profile.nickname
    from public.task_assignments as assignment
    left join public.profiles as profile on profile.id = assignment.member_id
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and assignment.ended_at is null
     and assignment.task_id = any(coalesce(p_task_ids, array[]::bigint[]))
     and private.can_read_task(assignment.task_id)
   order by assignment.task_id;
end;
$$;

comment on function private.visible_task_executors(bigint[]) is
  'Least-privilege #499 read implementation: returns only the current Executor identity (id, full name, Nickname) for Tasks the live caller may already read; Assignment history and contact fields remain private. At most 200 Task ids per call (PT400 too_many_ids, security pass I1).';

comment on function public.visible_task_executors(bigint[]) is
  'Authenticated RPC for #499. Accepts at most 200 Task ids (PT400 too_many_ids) and returns only each readable Task current Executor id, full name and Nickname.';

-- 2. ----------------------------------------------------------------------

revoke insert, update, delete on table public.roles            from authenticated;
revoke insert, update, delete on table public.difficulty_guide from authenticated;
revoke insert, update, delete on table public.rating_guide     from authenticated;
revoke insert, delete         on table public.profiles         from authenticated;

-- 3. ----------------------------------------------------------------------

drop extension if exists pg_graphql;
