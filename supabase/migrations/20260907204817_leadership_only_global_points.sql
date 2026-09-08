-- #254: global point metrics belong to BCE, BC, and Moderator only.
--
-- member_points deliberately keeps owner rights because it must aggregate
-- ledger rows that no single member may inspect. Its WHERE clause is therefore
-- the security boundary. The two public derived views keep security-invoker
-- behavior and repeat the leadership gate as defense in depth.

create or replace view public.member_points
with (security_invoker = off)
as
  select p.id as member_id,
         coalesce(sum(l.delta), 0)::int as points
    from public.profiles p
    left join public.points_ledger l on l.member_id = p.id
   where public.auth_level() >= 5
      or current_user not in ('authenticated', 'anon')
   group by p.id;

comment on view public.member_points is
  'Global point totals for BCE, BC, Moderator, and trusted server roles. Owner rights are deliberate so the aggregate can cross points_ledger RLS; the leadership predicate is the security boundary. Ordinary members use a separate own-total endpoint.';

create or replace view public.leaderboard
with (security_invoker = on)
as
  select mp.member_id,
         pr.full_name,
         pr.role,
         mp.points,
         rank() over (order by mp.points desc) as rank
    from public.member_points mp
    join public.profiles pr on pr.id = mp.member_id
   where (
           public.auth_level() >= 5
           or current_user not in ('authenticated', 'anon')
         )
     and pr.status = 'activ';

comment on view public.leaderboard is
  'Legacy global leaderboard, now visible only to BCE, BC, Moderator, and trusted server roles. A task-only leadership leaderboard replaces its contents in a later migration.';

create or replace view public.dept_cup
with (security_invoker = on)
as
  select d.id as dept_id,
         d.name,
         coalesce(sum(mp.points), 0)::int as points,
         count(distinct p.id) as members
    from public.departments d
    left join public.member_departments md on md.dept_id = d.id
    left join public.profiles p
      on p.id = md.member_id
     and p.status = 'activ'
    left join public.member_points mp on mp.member_id = p.id
   where (
           public.auth_level() >= 5
           or current_user not in ('authenticated', 'anon')
         )
     and d.kind = 'department'
   group by d.id, d.name
   order by points desc, d.name asc;

comment on view public.dept_cup is
  'Department standings visible only to BCE, BC, Moderator, and trusted server roles. Task-origin qualification is added with the normalized Task Tracker schema.';
