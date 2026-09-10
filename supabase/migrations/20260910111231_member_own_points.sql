-- #255: active members need a narrow endpoint for their own score now that
-- the global point views are leadership-only.

create view public.my_points
with (security_invoker = on)
as
  select p.id as member_id,
         coalesce(sum(l.delta), 0)::int as points
    from public.profiles p
    left join public.points_ledger l on l.member_id = p.id
   where public.auth_is_member()
     and p.id = (select auth.uid())
     and p.status = 'activ'
   group by p.id;

comment on view public.my_points is
  'The current active member''s complete personal points total. Identity comes from auth.uid(); task points and sanctions are both included. This security-invoker view intentionally exposes at most one row and never accepts a member ID from the client.';

-- Views receive the project-wide default DML grants because PostgreSQL treats
-- them as tables for privileges. Replace those defaults with the only client
-- operation this endpoint supports.
revoke all on table public.my_points from public, anon, authenticated, service_role;
grant select on table public.my_points to authenticated, service_role;
