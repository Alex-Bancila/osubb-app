-- #372: ADR-0008 §Visibility — "Every active OSUBB member, including a
-- Recrut, may read every future Event whose Minimum Level they satisfy,
-- regardless of Event scope." Scope stops being a visibility boundary; it
-- is relevance only, a frontend concern (primary vs gray grouping). This
-- migration retires the old scope-branch `event_read` policy (and the
-- `for_recruits` exception it depended on) in favor of one Minimum Level
-- check, and drops the column/helper the old rule used.
--
-- Decision 1 — live level, not the JWT's auth_level(). Every other policy
-- Stack C added this cycle reads the caller's role from a live
-- profiles/roles join (private.can_read_task, private.is_task_executor,
-- private.can_manage_task, …) precisely because a deactivated member keeps
-- their auth uid and their `profiles` row — their JWT can still carry a
-- stale `member_level` claim for the lifetime of the token (house rule 12's
-- own wording; also documented at set_event_rsvp's "JWT claims can remain
-- valid briefly after deactivation"). Events have no assignment/candidate
-- row of their own to fall back on as a second guard the way Tasks do, so
-- the live join is the *only* thing standing between a deactivated member
-- and the calendar once their token is stale. `private.actor_level()`
-- below is the live analogue of `auth_level()`: it returns -1 (never
-- satisfies even `min_level = 0`) for anyone without a live, active
-- Profile row, so a deactivated member is denied regardless of what their
-- token still claims. Cost: `private.actor_level()` takes no row-dependent
-- argument, so the policy calls it as `(select private.actor_level())`
-- (same idiom as `(select public.auth_level()) >= 6` in
-- 20260910135327/20260910144445) — Postgres evaluates it once per query as
-- an InitPlan, not once per row, so the extra profiles/roles lookup (one
-- indexed read each) is paid once per statement, not once per Event.
--
-- Decision 2 — "future events only" stays a frontend concern, not a policy
-- clause. ADR-0008 says ordinary members "do not receive past Events in
-- this phase", but the frontend already enforces this at the query layer
-- (`app/src/queries/events.ts`'s `.gte('starts_at', now)`), and folding it
-- into the RLS predicate would take away a member's ability to read an
-- Event they already RSVP'd to the moment it starts: `set_event_rsvp`'s
-- own visibility check and `attendance_read`'s `exists (select 1 from
-- events …)` both read through this same policy with no separate escape
-- hatch, so a starts_at-gated `events_read` would make the RSVP flow throw
-- `event_not_visible`/return nothing for an Event already under way. A
-- past-Events restriction belongs to a later Calendar issue that can also
-- decide how it interacts with RSVP history, not here.

-- ==================== Live level ====================

create function private.actor_level() returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select caller_role.level
       from public.profiles as caller
       join public.roles as caller_role on caller_role.id = caller.role
      where caller.id = (select auth.uid())
        and caller.status = 'activ'),
    -1
  );
$$;

comment on function private.actor_level() is
  'Live analogue of auth_level(): the caller''s current role level from profiles/roles, or -1 with no active membership row. Unlike auth_level(), a deactivated member''s stale JWT cannot satisfy it (#372, ADR-0008 Visibility). No row-dependent argument — call as (select private.actor_level()) so Postgres caches one evaluation per query.';

revoke execute on function private.actor_level()
  from public, anon, authenticated, service_role;
grant execute on function private.actor_level() to authenticated;

-- ==================== Policy ====================

drop policy event_read on public.events;

create policy events_read on public.events
  for select to authenticated
  using (
    (select public.auth_is_member())
    and (select private.actor_level()) >= min_level
  );

comment on policy events_read on public.events is
  'ADR-0008 Visibility: any active member reads any Event whose Minimum Level they satisfy, regardless of scope (#372). Renamed from the grandfathered event_read (docs/backend/conventions.md §5 still lists the old name on main; #372''s PR body flags the follow-up). "Future events only" is a frontend filter, not enforced here — see this migration''s header, decision 2.';

-- ==================== Retire the recruit-team exception ====================

drop function public.team_admits_recruits(text);

alter table public.teams drop column for_recruits;
