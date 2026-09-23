-- #509 / #585: the forward mirror stays live until #586. Owner DML replaces
-- the retired legacy client commands in this transitional proof.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is((select count(*) from pg_trigger where not tgisinternal
  and tgname in ('departments_mirror_group', 'teams_mirror_group',
    'projects_mirror_group', 'member_departments_mirror_membership',
    'team_members_mirror_membership', 'project_members_mirror_membership')),
  6::bigint, 'all six legacy-table mirrors still fire');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid = 'public.profiles'::regclass
  and tgname = 'profiles_rederive_group_roles'),
  'the temporary Role rederivation mirror still fires');

insert into auth.users(id,email) values
  ('50900000-0000-0000-0000-000000000011','mirror.bc.509@test.local'),
  ('50900000-0000-0000-0000-000000000012','mirror.member.509@test.local');
insert into public.profiles(id,full_name,email,role,status) values
  ('50900000-0000-0000-0000-000000000011','Mirror BC','mirror.bc.509@test.local','bc','activ'),
  ('50900000-0000-0000-0000-000000000012','Mirror Member','mirror.member.509@test.local','voluntar','activ');
insert into public.teams(id,name,dept_id)
values ('mirror-team-509','Mirror Team','edu');
select is((select name from public.groups where legacy_team_id='mirror-team-509'),
  'Mirror Team', 'a Team insert mirrors its Group');
insert into public.team_members(team_id,member_id)
values ('mirror-team-509','50900000-0000-0000-0000-000000000012');
select is((select gm.group_role from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where g.legacy_team_id='mirror-team-509'
    and gm.member_id='50900000-0000-0000-0000-000000000012'),
  'member', 'a Team roster insert mirrors an ordinary Group member');

insert into public.projects(name,leader_id,created_by)
values ('Mirror Project 509','50900000-0000-0000-0000-000000000011',
  '50900000-0000-0000-0000-000000000011');
select is((select gm.group_role from public.group_members gm
  join public.groups g on g.id=gm.group_id
  join public.projects p on p.id=g.legacy_project_id
  where p.name='Mirror Project 509'
    and gm.member_id='50900000-0000-0000-0000-000000000011'),
  'manager', 'the Project leader mirrors as Group Manager');
insert into public.project_members(project_id,member_id,project_role)
select id,'50900000-0000-0000-0000-000000000012','responsible'
from public.projects where name='Mirror Project 509';
select is((select gm.group_role from public.group_members gm
  join public.groups g on g.id=gm.group_id
  join public.projects p on p.id=g.legacy_project_id
  where p.name='Mirror Project 509'
    and gm.member_id='50900000-0000-0000-0000-000000000012'),
  'responsible', 'a Project roster insert mirrors the Responsible');

create temp table mirror_before as
select g.id,g.name,g.status,g.path,
  (select jsonb_agg(jsonb_build_array(gm.member_id,gm.group_role)
                    order by gm.member_id)
   from public.group_members gm where gm.group_id=g.id) as roster
from public.groups g
where g.legacy_team_id='mirror-team-509'
   or g.legacy_project_id=(select id from public.projects where name='Mirror Project 509');
select private.sync_groups_from_legacy();
select is((select jsonb_agg(to_jsonb(x) order by x.id) from mirror_before x),
  (select jsonb_agg(to_jsonb(x) order by x.id) from (
    select g.id,g.name,g.status,g.path,
      (select jsonb_agg(jsonb_build_array(gm.member_id,gm.group_role)
                        order by gm.member_id)
       from public.group_members gm where gm.group_id=g.id) as roster
    from public.groups g
    where g.legacy_team_id='mirror-team-509'
       or g.legacy_project_id=(select id from public.projects where name='Mirror Project 509')
  ) x), 'a full mirror repair is a fixpoint');
select is(has_function_privilege('authenticated','private.mirror_team_group()','execute'),
  false, 'a client cannot call a mirror trigger function');
select * from finish();
rollback;
