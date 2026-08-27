-- Keep the competition structurally complete while ensuring that people who
-- no longer have organization access cannot influence the live standings.
--
-- `departments` is the left side of every join so a configured department is
-- present before its first member joins. Joining `profiles` with the active
-- predicate before `member_points` makes both the member count and points sum
-- use the same eligibility rule.
create or replace view public.dept_cup with (security_invoker = on) as
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
   where d.kind = 'department'
   group by d.id, d.name
   order by points desc, d.name asc;

comment on view public.dept_cup is
  'Department standings across all configured departments. Only active profiles contribute members or points; empty departments remain visible at zero.';
