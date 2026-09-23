-- #520: live Group authority, per-Group membership, nearest managers and locked revocation.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(85);
select has_function('private', 'group_role_of', array['bigint','uuid'], 'group_role_of exists');
select has_function('private', 'is_group_member', array['bigint','uuid'], 'is_group_member exists');
select has_function('private', 'has_group_manager', array['bigint'], 'has_group_manager exists');
select has_function('private', 'is_group_manager', array['bigint'], 'is_group_manager exists');
select has_function('private', 'is_group_responsible', array['bigint'], 'is_group_responsible exists');
select has_function('private', 'can_manage_group_work', array['bigint'], 'can_manage_group_work exists');
select has_function('private', 'require_group_work_manager', array['bigint'], 'require_group_work_manager exists');
select has_function('private', 'group_managers', array['bigint'], 'group_managers exists');
-- Existence alone is not the interface. A helper that quietly loses `security definer`
-- still answers every behavioural assertion below, because the three caller-facing
-- predicates are definers themselves and run it as the owner either way -- the gap only
-- opens for a future direct caller under RLS. Pin the declaration, not just the name.
-- Postgres stores an empty search_path as the literal proconfig entry search_path=""
-- (conventions.test.sql confirmed that spelling against the live database).
create function pg_temp.group_kit_shape_violations() returns text[]
language sql as $$
  select coalesce(array_agg(p.proname
           || case when not p.prosecdef then ' (not security definer)'
                   else ' (search_path not pinned to the empty string)' end
           order by p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('group_role_of', 'is_group_member', 'has_group_manager',
                       'is_group_manager', 'is_group_responsible', 'can_manage_group_work',
                       'require_group_work_manager', 'group_managers')
     and (not p.prosecdef
          or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                          where c = 'search_path=""'));
$$;
select is(pg_temp.group_kit_shape_violations(), '{}'::text[],
  'every Group authority helper is security definer with search_path pinned to the empty string');
create temp table people (n integer, name text, role public.member_role, status public.member_status);
insert into people values
(1,'bc','bc','activ'),(2,'bce_edu','bce','activ'),(3,'bce_foreign','bce','activ'),
(4,'coord','voluntar','activ'),(5,'resp','voluntar','activ'),(6,'ordinary_edu','voluntar','activ'),
(7,'ordinary_proj','voluntar','activ'),(8,'ind_a','voluntar','activ'),(9,'ind_b','voluntar','activ'),
(10,'dt_member','voluntar','activ'),(11,'vot','vot','activ'),(12,'inactive_bce','bce','inactiv'),
(13,'claimless','voluntar','activ'),(14,'moderator','moderator','activ');
insert into auth.users(id,email)
select ('52000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, name || '.520@test.local' from people;
insert into public.profiles(id,full_name,email,role,status)
select ('52000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,name,name || '.520@test.local',role,status from people;
insert into public.member_departments(member_id,dept_id)
select ('52000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
case when n=3 then 'pr' else 'edu' end from people where n in (2,3,4,6,12,13);
insert into public.teams(id,name,dept_id) values ('t-520-dt','Child #520','edu'),('t-520-ind','Independent #520',null);
insert into public.team_members(team_id,member_id) values
('t-520-dt','52000000-0000-0000-0000-000000000010'),
('t-520-ind','52000000-0000-0000-0000-000000000008'),
('t-520-ind','52000000-0000-0000-0000-000000000009');
insert into public.projects(name,leader_id,created_by) values
('Project #520','52000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000001'),
('Archived #520','52000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000001');
insert into public.project_members(project_id,member_id,project_role)
select id,'52000000-0000-0000-0000-000000000005','responsible' from public.projects where name='Project #520';
insert into public.project_members(project_id,member_id,project_role)
select id,'52000000-0000-0000-0000-000000000007','member' from public.projects where name='Project #520';
update public.projects set status='archived' where name='Archived #520';
-- Wave 2 OD9 exception: gated/native fixtures only, rolled back with this suite.
update public.groups set min_level=3, application_level=3 where legacy_team_id='t-520-dt';
insert into public.groups(name,category,min_level,automatic_membership) values ('AG #520','team',3,true);
create temp table fx as
select id, case when legacy_dept_id='edu' then 'edu' when legacy_dept_id='org' then 'org'
when legacy_team_id='t-520-dt' then 'dt' when legacy_team_id='t-520-ind' then 'ind'
when name='Project #520' then 'project' when name='Archived #520' then 'archived'
when name='AG #520' then 'ag' end as name from public.groups;
grant select on fx to authenticated,anon;

select is(private.group_role_of((select id from fx where name = 'dt'), '52000000-0000-0000-0000-000000000002'), 'manager', 'Manager flows down');
select is(private.group_role_of((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000010'), null::text, 'membership never flows up');
select is(private.group_role_of((select id from fx where name = 'dt'), '52000000-0000-0000-0000-000000000006'), null::text, 'Department membership does not enter Child Group');
select is(private.group_role_of((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000006'), 'member', 'ordinary membership is local');
select is(private.group_role_of((select id from fx where name = 'project'), '52000000-0000-0000-0000-000000000004'), 'manager', 'Project Manager');
select is(private.group_role_of((select id from fx where name = 'project'), '52000000-0000-0000-0000-000000000005'), 'responsible', 'Project Responsible');
select is(private.group_role_of((select id from fx where name = 'project'), '52000000-0000-0000-0000-000000000007'), 'member', 'Project ordinary member');
select is(private.group_role_of((select id from fx where name = 'project'), '52000000-0000-0000-0000-000000000006'), null::text, 'unrelated member has no role');
select is(private.group_role_of((select id from fx where name = 'ind'), '52000000-0000-0000-0000-000000000008'), 'responsible', 'Independent Team member is Responsible');
select is(private.group_role_of((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000004'), 'member', 'a Project Manager is ordinary in another Group');
select is(private.group_role_of((select id from fx where name = 'org'), '52000000-0000-0000-0000-000000000011'), 'member', 'Organization automatic membership');
select is(private.group_role_of((select id from fx where name = 'ag'), '52000000-0000-0000-0000-000000000011'), 'member', 'automatic membership at Minimum Level');
select is(private.group_role_of((select id from fx where name = 'ag'), '52000000-0000-0000-0000-000000000006'), null::text, 'automatic membership excludes lower levels');
select is(private.group_role_of((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000012'), null::text, 'inactive Member has no live role');
select is(private.has_group_manager((select id from fx where name = 'dt')),true,'ancestor has a live Manager');
select is(private.has_group_manager((select id from fx where name = 'ind')),false,'Independent Team has no Manager');
select is(private.is_group_member((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000002'),true,'explicit roster membership edu');
select is(private.is_group_member((select id from fx where name = 'project'), '52000000-0000-0000-0000-000000000004'),true,'explicit roster membership project');
select is(private.is_group_member((select id from fx where name = 'ind'), '52000000-0000-0000-0000-000000000008'),true,'explicit roster membership ind');
select is(private.is_group_member((select id from fx where name = 'dt'), '52000000-0000-0000-0000-000000000002'),false,'inherited authority is not explicit Child membership');
select is(private.is_group_member((select id from fx where name = 'dt'), '52000000-0000-0000-0000-000000000010'),true,'existing explicit membership survives a raised Minimum Level');
select is(private.is_group_member((select id from fx where name = 'org'), '52000000-0000-0000-0000-000000000011'),true,'automatic Organization membership');
select is(private.is_group_member((select id from fx where name = 'ag'), '52000000-0000-0000-0000-000000000006'),false,'automatic Group Minimum Level applies');
select is(private.is_group_member((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000012'),false,'inactive explicit membership is ignored');
-- The other direction of ruling D2: the Child Group's roster is not the Department's.
-- Only this assertion fails if the exists() is rewritten to accept a descendant's roster row.
select is(private.is_group_member((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000010'),false,'Child Group membership never counts as membership of the ancestor');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000001');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),true,'persona 1 manage edu: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000002');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),true,'persona 2 manage edu: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000003');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'persona 3 manage edu: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000006');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'persona 6 manage edu: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000011');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'persona 11 manage edu: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000012');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'persona 12 manage edu: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000002');
select is(private.can_manage_group_work((select id from fx where name = 'dt')),true,'persona 2 manage dt: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000010');
select is(private.can_manage_group_work((select id from fx where name = 'dt')),false,'persona 10 manage dt: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000004');
select is(private.can_manage_group_work((select id from fx where name = 'project')),true,'persona 4 manage project: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000005');
select is(private.can_manage_group_work((select id from fx where name = 'project')),true,'persona 5 manage project: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000007');
select is(private.can_manage_group_work((select id from fx where name = 'project')),false,'persona 7 manage project: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000008');
select is(private.can_manage_group_work((select id from fx where name = 'ind')),true,'persona 8 manage ind: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000002');
select is(private.can_manage_group_work((select id from fx where name = 'ind')),false,'persona 2 manage ind: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000004');
select is(private.can_manage_group_work((select id from fx where name = 'archived')),false,'persona 4 manage archived: False');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000001');
select is(private.can_manage_group_work((select id from fx where name = 'archived')),true,'persona 1 manage archived: True');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000014');
select is(private.can_manage_group_work((select id from fx where name = 'archived')),true,'persona 14 manage archived: True');
reset role;
select pg_temp.test_login('52000000-0000-0000-0000-000000000013', '{"provider":"email"}');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'claimless caller denied by can_manage_group_work');
select is(private.is_group_manager((select id from fx where name = 'edu')),false,'claimless caller denied by is_group_manager');
select is(private.is_group_responsible((select id from fx where name = 'edu')),false,'claimless caller denied by is_group_responsible');
reset role; select pg_temp.test_login('52000000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select is(private.can_manage_group_work((select id from fx where name = 'edu')),false,'forged stale BC claim does not grant authority');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000004');
select is(private.is_group_manager((select id from fx where name = 'project')),true,'is_group_manager returns a strict boolean for persona 4');
select is(private.is_group_responsible((select id from fx where name = 'project')),false,'is_group_responsible returns a strict boolean for persona 4');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000005');
select is(private.is_group_manager((select id from fx where name = 'project')),false,'is_group_manager returns a strict boolean for persona 5');
select is(private.is_group_responsible((select id from fx where name = 'project')),true,'is_group_responsible returns a strict boolean for persona 5');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000007');
select is(private.is_group_manager((select id from fx where name = 'project')),false,'is_group_manager returns a strict boolean for persona 7');
select is(private.is_group_responsible((select id from fx where name = 'project')),false,'is_group_responsible returns a strict boolean for persona 7');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000004');
reset role;
select is(private.require_group_work_manager((select id from fx where name = 'project')),'52000000-0000-0000-0000-000000000004'::uuid,'require returns actor 4');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000005');
reset role;
select is(private.require_group_work_manager((select id from fx where name = 'project')),'52000000-0000-0000-0000-000000000005'::uuid,'require returns actor 5');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000007');
reset role;
select throws_ok($$select private.require_group_work_manager((select id from fx where name = 'project'))$$,'42501','group_manage_forbidden','require refuses persona 7');
reset role;
select pg_temp.test_login('52000000-0000-0000-0000-000000000013', '{"provider":"email"}');
reset role;
select throws_ok($$select private.require_group_work_manager((select id from fx where name = 'project'))$$,'42501','group_manage_forbidden','require refuses persona 13');
reset role;
select pg_temp.test_login_leadership('52000000-0000-0000-0000-000000000001');
select is(private.can_manage_group_work(-520),false,'missing Group refused even to BC');
reset role;
select throws_ok($$select private.require_group_work_manager(-520)$$,'42501','group_manage_forbidden','require refuses missing Group');
select results_eq($$select private.group_managers((select id from fx where name = 'dt')) order by 1$$,$$select '52000000-0000-0000-0000-000000000002'::uuid$$,'nearest Manager set for dt');
select results_eq($$select private.group_managers((select id from fx where name = 'project')) order by 1$$,$$select '52000000-0000-0000-0000-000000000004'::uuid$$,'nearest Manager set for project');
select results_eq($$select private.group_managers((select id from fx where name = 'ind')) order by 1$$,$$select p.id from public.profiles p join public.roles r on r.id=p.role where p.status='activ' and (r.level>=6 or p.id in ('52000000-0000-0000-0000-000000000008','52000000-0000-0000-0000-000000000009')) order by 1$$,'Manager-less Group gets peers and live BC or Moderator');
savepoint inactive;
update public.profiles set status='inactiv' where id='52000000-0000-0000-0000-000000000002';
select is(private.has_group_manager((select id from fx where name = 'dt')),false,'inactive ancestor Manager ignored');
rollback to inactive;
insert into public.groups(name,category,parent_id) values ('Nearest #520','team',(select id from fx where name = 'project'));
insert into public.group_members(group_id,member_id,group_role) select id,'52000000-0000-0000-0000-000000000005','manager' from public.groups where name='Nearest #520';
insert into fx select id,'nearest' from public.groups where name='Nearest #520';
select results_eq($$select private.group_managers((select id from fx where name = 'nearest')) order by 1$$,$$select '52000000-0000-0000-0000-000000000005'::uuid$$,'nearest own Managers replace ancestor notification set');
select is(private.group_role_of((select id from fx where name = 'nearest'), '52000000-0000-0000-0000-000000000004'), 'manager', 'ancestor Manager retains authority below another Manager');
insert into public.group_members(group_id,member_id,group_role)
select id,'52000000-0000-0000-0000-000000000004','responsible' from public.groups where name='Nearest #520';
select is(private.group_role_of((select id from fx where name='nearest'),'52000000-0000-0000-0000-000000000004'),
'manager','ancestor Manager outranks a local Responsible role');
insert into public.groups(name,category,parent_id) values ('Responsible child #520','team',(select id from fx where name='project'));
select is(private.group_role_of((select id from public.groups where name='Responsible child #520'),'52000000-0000-0000-0000-000000000005'),
'responsible','Responsible authority flows to a Child Group');
set local role anon;
select throws_ok($$select private.can_manage_group_work((select id from fx where name = 'edu'))$$,'42501','permission denied for schema private','anon cannot reach authority predicates');
select throws_ok($$select private.is_group_member((select id from fx where name = 'edu'), '52000000-0000-0000-0000-000000000010')$$,'42501','permission denied for schema private','anon cannot reach the owner-only membership lookup');
reset role;
-- Native fixture follows the Wave 2 OD9 exception; no legacy leader invariant masks liveness.
insert into public.groups(name,category) values ('Inactive manager #520','project');
insert into public.group_members(group_id,member_id,group_role)
select id,'52000000-0000-0000-0000-000000000013','manager' from public.groups where name='Inactive manager #520';
insert into public.group_members(group_id,member_id,group_role)
select id,'52000000-0000-0000-0000-000000000005','responsible' from public.groups where name='Inactive manager #520';
savepoint inactive_native;
update public.profiles set status='inactiv' where id='52000000-0000-0000-0000-000000000013';
select results_eq($$select private.group_managers((select id from public.groups where name='Inactive manager #520')) order by 1$$,
$$select p.id from public.profiles p join public.roles r on r.id=p.role where p.status='activ'
and (r.level>=6 or p.id='52000000-0000-0000-0000-000000000005') order by 1$$,
'inactive Manager falls back to live Responsibles and BC or Moderator');
rollback to inactive_native;

-- Committed remote fixtures are required for lock observations and test_race.
-- Both setup and cleanup are idempotent so an interrupted run can be retried.
select extensions.dblink_connect('group_520_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('group_520_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('group_520_setup', $setup$
  drop function if exists public.test_520_require();
  drop function if exists public.test_520_revoke();
  delete from public.projects where name = 'Race #520';
  delete from auth.users where id in ('52000000-0000-0000-0000-000000000090',
    '52000000-0000-0000-0000-000000000091','52000000-0000-0000-0000-000000000092');
  insert into auth.users(id,email) values
    ('52000000-0000-0000-0000-000000000090','coord.race.520@test.local'),
    ('52000000-0000-0000-0000-000000000091','resp.race.520@test.local'),
    ('52000000-0000-0000-0000-000000000092','bc.race.520@test.local');
  insert into public.profiles(id,full_name,email,role,status) values
    ('52000000-0000-0000-0000-000000000090','Race coord','coord.race.520@test.local','voluntar','activ'),
    ('52000000-0000-0000-0000-000000000091','Race resp','resp.race.520@test.local','voluntar','activ'),
    ('52000000-0000-0000-0000-000000000092','Race BC','bc.race.520@test.local','bc','activ');
  insert into public.projects(name,leader_id,created_by) values
    ('Race #520','52000000-0000-0000-0000-000000000090','52000000-0000-0000-0000-000000000092');
  insert into public.project_members(project_id,member_id,project_role)
    select id,'52000000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #520';
  -- Test-only callable bridge to the owner-only gate, never a production grant.
  create function public.test_520_require() returns text
  language sql security definer set search_path = '' as $$
    select private.require_group_work_manager((select id from public.groups where name='Race #520'))::text
  $$;
  create function public.test_520_revoke() returns text
  language plpgsql security definer set search_path = '' as $$
  begin
    perform set_config('request.jwt.claims', '{"sub":"52000000-0000-0000-0000-000000000092","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}', true);
    return public.remove_project_member((select id from public.projects where name='Race #520'),
      '52000000-0000-0000-0000-000000000091')::text;
  end;
  $$;
  revoke execute on function public.test_520_require(), public.test_520_revoke() from public,anon,authenticated,service_role;
  grant execute on function public.test_520_require(), public.test_520_revoke() to authenticated;
$setup$);
select extensions.dblink_connect('group_520_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('group_520_lock', 'begin; set local statement_timeout = ''5s''; set local lock_timeout = ''2s'';');
select * from extensions.dblink('group_520_lock', $$select set_config('request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000091","role":"authenticated","app_metadata":{"member_role":"voluntar","member_level":1}}',true)$$) as claims(setting text);
select extensions.dblink_exec('group_520_lock','set local role authenticated');
select * from extensions.dblink('group_520_lock','select public.test_520_require()') as held(actor text);
select ok(exists(select 1 from extensions.pgrowlocks('public.group_members') l
  join public.group_members gm on gm.ctid=l.locked_row
  where gm.member_id='52000000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the deciding roster row FOR SHARE');
select ok(exists(select 1 from extensions.pgrowlocks('public.profiles') l
  join public.profiles p on p.ctid=l.locked_row
  where p.id='52000000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the live actor profile FOR SHARE');
select is((select count(*) from extensions.pgrowlocks('public.groups') l
  join public.groups g on g.ctid=l.locked_row where g.name='Race #520'),0::bigint,
  'gate never locks the Group row or blocks its mirror upsert');
select extensions.dblink_exec('group_520_lock','rollback');
select extensions.dblink_disconnect('group_520_lock');
select pg_temp.test_login('52000000-0000-0000-0000-000000000091',
  '{"member_role":"voluntar","member_level":1}');
reset role;
create temp table race_520 as select * from pg_temp.test_race(
  'select public.test_520_require()', 'select public.test_520_revoke()');
select is((select result_a from race_520),'52000000-0000-0000-0000-000000000091','authorized Responsible holds the gate');
select ok((select b_waited from race_520),'concurrent public roster revocation waits for Group authority');
select is((select result_b from race_520),'true','revocation completes after the authorized transaction commits');
select is(private.can_manage_group_work((select id from public.groups where name='Race #520')),false,
  'revoked Responsible loses authority despite retained claims');
select throws_ok($$select private.require_group_work_manager((select id from public.groups where name='Race #520'))$$,
  '42501','group_manage_forbidden','revoked Responsible cannot reacquire authority');
select extensions.dblink_exec('group_520_setup', $$
  drop function public.test_520_require();
  drop function public.test_520_revoke();
  delete from public.projects where name='Race #520';
  delete from auth.users where id in ('52000000-0000-0000-0000-000000000090',
    '52000000-0000-0000-0000-000000000091','52000000-0000-0000-0000-000000000092');
$$);
select extensions.dblink_disconnect('group_520_setup');

select * from finish();
rollback;
