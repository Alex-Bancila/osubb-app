-- #237: one atomic command for creating or changing the caller's RSVP.
-- SECURITY INVOKER is deliberate: event visibility and self-ownership stay
-- governed by the existing RLS policies instead of being copied into
-- privileged code that could drift from them.

-- event_read calls auth_role(). Its original body cast to the unqualified
-- `member_role` type, which fails when PostgreSQL inlines it beneath a caller
-- with an empty search_path. Keep the same public interface and privileges,
-- but make the helper safe in every security-hardened function context.
create or replace function public.auth_role()
returns public.member_role
language sql
stable
set search_path = ''
as $$
  select (auth.jwt() -> 'app_metadata' ->> 'member_role')::public.member_role
$$;

create or replace function public.set_event_rsvp(
  p_event_id bigint,
  p_status text
)
returns public.event_attendance
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member_id uuid := (select auth.uid());
  v_rsvp public.event_attendance%rowtype;
begin
  -- JWT claims can remain valid briefly after deactivation, so require both
  -- organisation claims and the live profile status before accepting a write.
  if v_member_id is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles p
        where p.id = v_member_id
          and p.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'not_active_member';
  end if;

  if p_status is null or p_status not in ('going', 'declined') then
    raise sqlstate 'PT400' using message = 'invalid_rsvp_status';
  end if;

  -- This SELECT runs as the caller. The event_read policy therefore hides
  -- inaccessible events; missing and hidden ids intentionally share one error
  -- so the RPC cannot be used to discover private calendar entries.
  if not exists (
    select 1
      from public.events e
     where e.id = p_event_id
  ) then
    raise sqlstate 'PT404' using message = 'event_not_visible';
  end if;

  -- The (event_id, member_id) primary key makes this one atomic insert-or-
  -- update operation. Only status changes on conflict; checked_in remains a
  -- server-owned value protected by its column grant.
  insert into public.event_attendance as attendance (
    event_id,
    member_id,
    status
  ) values (
    p_event_id,
    v_member_id,
    p_status
  )
  on conflict (event_id, member_id)
  do update
     set status = excluded.status
  returning attendance.* into v_rsvp;

  return v_rsvp;
end;
$$;

revoke execute on function public.set_event_rsvp(bigint, text)
  from public, anon;
grant execute on function public.set_event_rsvp(bigint, text)
  to authenticated;

comment on function public.set_event_rsvp(bigint, text) is
  'Atomically creates or changes auth.uid()''s RSVP for one visible event.';
