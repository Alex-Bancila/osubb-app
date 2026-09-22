-- #522: Group-native command boundaries and inherited ownership.
begin;
\set osubb_test_suite true
\ir _helpers.sql
\ir _group_task_fixtures.psql
set local search_path = public, extensions;
select plan(80);
create function pg_temp.g522_group(origin text) returns bigint language sql stable as $$
 select id from public.groups where name = origin
$$;
create temp table g522_ids(name text primary key,id bigint);
grant all on g522_ids to authenticated;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
set local role authenticated;
select lives_ok($$insert into g522_ids select 'task', (public.create_task('Group native',null,now()+interval '1 day',null,null,null,'local','direct',p_group_id => pg_temp.g522_group('Project #521'))).id$$,'level-1 Manager creates by Group');
select lives_ok($$insert into g522_ids select 'campaign',(public.create_campaign(pg_temp.g522_group('Project #521'),'Group campaign')).id$$,'Project Manager creates Campaign');
select throws_ok($q$select public.create_task('bad',null,now(),null,null,1,'local','direct',p_group_id=>pg_temp.g522_group('Project #521'))$q$,'PT400','invalid_origin','mixed Origin vocabularies are rejected');
select throws_ok($q$select public.create_task('bad',null,now(),null,null,null,'local','direct',p_group_id=>-1)$q$,'42501','task_manage_forbidden','unknown Group is nondisclosing for Group Manager');
select lives_ok($q$insert into g522_ids select 'umbrella',(public.create_task('Umbrella',null,null,null,null,null,null,null,p_kind=>'umbrella',p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'Group-native Umbrella');
select lives_ok($q$insert into g522_ids select 'child',(public.create_task('Child',null,now(),null,null,null,'local','direct',p_parent_task_id=>(select id from g522_ids where name='umbrella'))).id$q$,'Subtask inherits Group without supplied Origin');
select throws_ok($q$select public.create_task('bad',null,now(),null,null,null,'local','direct',p_parent_task_id=>(select id from g522_ids where name='umbrella'),p_group_id=>pg_temp.g522_group('Department #521'))$q$,'PT400','subtask_origin_mismatch','mismatched Subtask Group rejected');
select lives_ok($q$insert into g522_ids select 'clone',(public.duplicate_task((select id from g522_ids where name='task'),now()+interval '2 days')).id$q$,'duplicate copies Group');
select is((select group_id from public.tasks where id=(select id from g522_ids where name='clone')),pg_temp.g522_group('Project #521'),'clone keeps source Group');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($q$select public.update_campaign((select id from g522_ids where name='campaign'),'Renamed')$q$,'Responsible renames Project Campaign');
select lives_ok($q$select public.set_campaign_active((select id from g522_ids where name='campaign'),false)$q$,'Responsible deactivates Campaign');
select lives_ok($q$select public.set_campaign_active((select id from g522_ids where name='campaign'),true)$q$,'Responsible reactivates Campaign');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Project #521'),'Ordinary')$q$,'42501','campaign_manage_forbidden','ordinary member cannot create Campaign');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(9));
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Project #521'),'Foreign')$q$,'42501','campaign_manage_forbidden','unrelated BCE cannot manage Project');
select lives_ok($q$insert into g522_ids select 'department-campaign',(public.create_campaign(pg_temp.g522_group('Department #521'),'Shared name')).id$q$,'Department Group Manager creates Campaign');
select lives_ok($q$select public.create_campaign('d521','Legacy Campaign')$q$,'legacy Department wrapper still resolves');
select throws_ok($q$select public.create_campaign('missing-522','Hidden')$q$,'42501','campaign_manage_forbidden','unknown legacy Department is nondisclosing');
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Department #521'),'shared NAME')$q$,'PT409','campaign_name_taken','Group-local name uniqueness maps conflict');
select lives_ok($q$insert into g522_ids select 'team-campaign',(public.create_campaign(pg_temp.g522_group('Child #521'),'Shared name')).id$q$,'same Campaign name in another Group allowed');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($q$select public.create_campaign(pg_temp.g522_group('Independent #521'),'Independent')$q$,'Independent Team Responsible creates Campaign');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Archived #521'),'Archived')$q$,'42501','campaign_manage_forbidden','archived Group disallows local Campaign manager');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($q$select public.create_task('bad',null,now(),null,null,null,'local','direct',p_group_id=>-1)$q$,'42501','task_manage_forbidden','unknown Group is nondisclosing for BC too');
select lives_ok($q$select public.create_campaign((select id from public.groups where legacy_dept_id='org'),'Organization 522')$q$,'BC manages Organization Campaign');
reset role;
select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='child')$q$,'23514','subtask_origin_immutable','Group-only Subtask edit reaches hierarchy trigger');
select lives_ok($q$update public.tasks set campaign_id=(select id from g522_ids where name='campaign') where id=(select id from g522_ids where name='task')$q$,'Project Campaign tags Project Task');
select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='task')$q$,'23514','task_campaign_origin_mismatch','Group-only edit reaches Campaign trigger');
select lives_ok($q$insert into public.tasks(title,deadline,group_id,campaign_id,audience,assignment_mode,status) values('descendant',now(),pg_temp.g522_group('Child #521'),(select id from g522_ids where name='department-campaign'),'local','direct','todo')$q$,'ancestor Campaign tags descendant Task');
select throws_ok($q$insert into public.tasks(title,deadline,group_id,campaign_id,audience,assignment_mode,status) values('ancestor',now(),pg_temp.g522_group('Department #521'),(select id from g522_ids where name='team-campaign'),'local','direct','todo')$q$,'23514','task_campaign_origin_mismatch','descendant Campaign cannot tag ancestor Task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select lives_ok($q$insert into g522_ids select 'request-5',(public.create_completed_work_request('Request #522 5',null,null,null,p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'persona 5 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-5'),'Self')$q$,'42501','request_decide_forbidden','persona 5 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-5')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'deciders for persona 5');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-5') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'notifications match deciders for persona 5');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($q$insert into g522_ids select 'request-3',(public.create_completed_work_request('Request #522 3',null,null,null,p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'persona 3 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-3'),'Self')$q$,'42501','request_decide_forbidden','persona 3 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-3')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text], 'deciders for persona 3');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-3') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text], 'notifications match deciders for persona 3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$insert into g522_ids select 'request-2',(public.create_completed_work_request('Request #522 2',null,null,null,p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'persona 2 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-2'),'Self')$q$,'42501','request_decide_forbidden','persona 2 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-2')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text], 'deciders for persona 2');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-2') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text], 'notifications match deciders for persona 2');
insert into public.group_members(group_id,member_id,group_role) values(pg_temp.g522_group('Project #521'),pg_temp.g521_uid(1),'member');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$insert into g522_ids select 'request-1',(public.create_completed_work_request('Request #522 1',null,null,null,p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'persona 1 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-1'),'Self')$q$,'42501','request_decide_forbidden','persona 1 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-1')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'deciders for persona 1');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-1') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'notifications match deciders for persona 1');
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(5),pg_temp.g522_group('Project #521'),'Twin 5-1');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$select public.approve_completed_work_request((select id from public.completed_work_requests where description='Twin 5-1'),3,3,'Approved')$q$,'decider 1 acts on requester 5 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(5),pg_temp.g522_group('Project #521'),'Twin 5-2');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$select public.reject_completed_work_request((select id from public.completed_work_requests where description='Twin 5-2'),'Rejected')$q$,'decider 2 acts on requester 5 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(5),pg_temp.g522_group('Project #521'),'Twin 5-3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($q$select public.approve_completed_work_request((select id from public.completed_work_requests where description='Twin 5-3'),3,3,'Approved')$q$,'decider 3 acts on requester 5 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(5),pg_temp.g522_group('Project #521'),'Twin 5-4');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(4));
select lives_ok($q$select public.reject_completed_work_request((select id from public.completed_work_requests where description='Twin 5-4'),'Rejected')$q$,'decider 4 acts on requester 5 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(3),pg_temp.g522_group('Project #521'),'Twin 3-1');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$select public.approve_completed_work_request((select id from public.completed_work_requests where description='Twin 3-1'),3,3,'Approved')$q$,'decider 1 acts on requester 3 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(3),pg_temp.g522_group('Project #521'),'Twin 3-2');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$select public.reject_completed_work_request((select id from public.completed_work_requests where description='Twin 3-2'),'Rejected')$q$,'decider 2 acts on requester 3 twin');
reset role;
insert into public.completed_work_requests(requester_id,group_id,description) values(pg_temp.g521_uid(2),pg_temp.g522_group('Project #521'),'Twin 2-1');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$select public.approve_completed_work_request((select id from public.completed_work_requests where description='Twin 2-1'),3,3,'Approved')$q$,'decider 1 acts on requester 2 twin');
reset role;
select ok(not exists(select 1 from public.completed_work_requests r join public.tasks t on t.id=r.task_id where r.description like 'Twin %' and r.group_id<>t.group_id),'approved Task inherits Request Group');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-2'),'Peer')$q$,'42501','request_decide_forbidden','Responsible cannot decide protected persona 2');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-3'),'Peer')$q$,'42501','request_decide_forbidden','Responsible cannot decide protected persona 3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select is((select count(*) from public.completed_work_requests where description like 'Request #522 %'),1::bigint,'ordinary member reads only own Request');
select throws_ok($q$select public.create_completed_work_request('Mixed', 'd521',null,null,p_group_id=>pg_temp.g522_group('Project #521'))$q$,'PT400','invalid_origin','Request rejects multiple vocabularies');
select throws_ok($q$select public.create_completed_work_request('Missing',null,null,null,p_group_id=>-1)$q$,'42501','request_origin_forbidden','unknown Request Group is nondisclosing');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select throws_ok($q$select public.create_completed_work_request('Archived',null,null,null,p_group_id=>pg_temp.g522_group('Archived #521'))$q$,'42501','request_origin_forbidden','cannot file into archived Group');
reset role;
select pg_temp.test_login(pg_temp.g521_uid(2), '{}'::jsonb);
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Project #521'),'Claimless')$q$,'42501','campaign_manage_forbidden','claimless Group Manager cannot create Campaign');
select throws_ok($q$select public.create_completed_work_request('Claimless',null,null,null,p_group_id=>-1)$q$,'42501','request_command_forbidden','claimless member cannot file Request');
reset role;
-- Wave 2 retains the mapped legacy Origin boundary; native Campaigns are supported.
insert into public.groups(name, category, parent_id, path, automatic_membership)
values ('Native #522','team',pg_temp.g522_group('Project #521'),'{}',true);
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select throws_ok($q$select public.create_task('Native',null,now(),null,null,null,'local','direct',p_group_id=>pg_temp.g522_group('Native #522'))$q$,'23514','task_group_origin_unmapped','unmapped Task Group remains rejected until Wave 3');
select lives_ok($q$select public.create_campaign(pg_temp.g522_group('Native #522'),'Native Campaign')$q$,'ancestor Manager creates native child Group Campaign');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select throws_ok($q$select public.create_completed_work_request('Native request',null,null,null,p_group_id=>pg_temp.g522_group('Native #522'))$q$,'23514','request_group_origin_unmapped','unmapped Request Group remains rejected until Wave 3');
reset role;

-- ==================== #522 plan delta: the rulings the matrix above does not yet separate ====================
--
-- Everything in this section exists because a mutation of the shipped body left every
-- assertion above green. Each one is written against the rule it pins, not against the
-- shape of the code that happens to satisfy it today.

-- Ruling D2: Request membership is PER GROUP. Manager and Responsible flow down the path
-- (private.group_role_of), plain membership never does -- in either direction. Replacing
-- create_completed_work_request_impl's `group_role_of(v_group, v_actor) is not null` with a
-- path walk over group_members leaves the whole matrix above green; these two do not.
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select throws_ok($q$select public.create_completed_work_request('Down the path #522',null,null,null,p_group_id=>pg_temp.g522_group('Child #521'))$q$,
  '42501','request_origin_forbidden','a Department member cannot file into the Department Team below it -- membership does not walk down the path');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($q$select public.create_completed_work_request('Up the path #522',null,null,null,p_group_id=>pg_temp.g522_group('Department #521'))$q$,
  '42501','request_origin_forbidden','a Department-Team member cannot file into the Department above it -- membership does not walk up the path either');
reset role;

-- private.can_decide_request gates on claims and liveness before it consults the decider set.
-- Every command that reaches it gates first, so only a direct call can tell the two apart.
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select is(private.can_decide_request((select id from g522_ids where name='request-5')), true,
  'can_decide_request admits a Group Manager of the Request Group with organization claims');
reset role;
select pg_temp.test_login(pg_temp.g521_uid(2), '{}'::jsonb);
select is(private.can_decide_request((select id from g522_ids where name='request-5')), false,
  'and refuses the same decider on a claimless session -- auth_is_member() is the gate, not the roster');
reset role;

-- ruling OD8: the Organization Group may own a Campaign, and only level >= 6 manages it.
-- A Department BCE is Automatic-Membership `member` there, never a manager.
select pg_temp.test_login_leadership(pg_temp.g521_uid(9));
select throws_ok($q$select public.create_campaign((select grp.id from public.groups as grp where grp.legacy_dept_id='org'),'BCE org 522')$q$,
  '42501','campaign_manage_forbidden','a Department BCE cannot own an Organization Campaign -- only level >= 6 manages the Organization Group');
reset role;

-- A Group-only create_task leaves the legacy triple to the #519 bridge.
select is((select format('%s|%s|%s',coalesce(task.dept_id,'-'),coalesce(task.team_id,'-'),coalesce(task.project_id::text,'-'))
             from public.tasks as task where task.id=(select id from g522_ids where name='task')),
  format('-|-|%s',(select project.id from public.projects as project where project.name='Project #521')),
  'a Group-only create_task derives dept_id/team_id/project_id instead of the caller supplying them');

-- The four writes below are `group_id = <the Group the command decided on>` in bodies whose
-- legacy triple is written beside it. While every Group still has a legacy master the bridge
-- derives the identical Group from that triple, so DELETING the group_id write changes
-- nothing observable -- the assertions above only catch a WRONG value. Turning the bridge off
-- inside this transaction removes the derivation and leaves the command's own write as the
-- only thing that can satisfy tasks.group_id NOT NULL. That is also the Wave 3 shape, where
-- the legacy columns are gone and these writes are the only ones left.
alter table public.tasks disable trigger tasks_sync_group_origin;

select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='child')$q$,
  '23514','subtask_origin_immutable','validate_task_hierarchy refuses a Subtask Group change on group_id alone, with no legacy edit to answer for it');
-- The legacy triple here is the Umbrella's own, so the three legacy comparisons all agree and
-- only `new.group_id is distinct from v_parent_group` is left to refuse the Subtask.
select throws_ok($q$insert into public.tasks(title,deadline,group_id,project_id,parent_task_id,audience,assignment_mode,status,kind)
  values('Mismatch #522',now(),pg_temp.g522_group('Department #521'),
         (select project.id from public.projects as project where project.name='Project #521'),
         (select id from g522_ids where name='umbrella'),'local','direct','todo','task')$q$,
  '23514','subtask_origin_mismatch','and refuses a Subtask whose group_id alone differs from its Umbrella''s');

select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$insert into g522_ids select 'clone-nobridge',(public.duplicate_task((select id from g522_ids where name='task'),now()+interval '3 days')).id$q$,
  'duplicate_task writes group_id itself: the clone still lands with the bridge off');
reset role;
select is((select task.group_id from public.tasks as task where task.id=(select id from g522_ids where name='clone-nobridge')),
  pg_temp.g522_group('Project #521'),'and it is the source Group, written by the command rather than derived');

select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$select public.approve_completed_work_request((select id from g522_ids where name='request-5'),3,3,'Bridge off #522')$q$,
  'approve_completed_work_request writes the new Task''s group_id itself: it still lands with the bridge off');
reset role;
select is((select task.group_id from public.completed_work_requests as request
             join public.tasks as task on task.id=request.task_id
            where request.id=(select id from g522_ids where name='request-5')),
  pg_temp.g522_group('Project #521'),'and it is the Request''s Group, written by the command rather than derived');

alter table public.tasks enable trigger tasks_sync_group_origin;

-- An archived Group has no local deciders. With no other active BC/Moderator,
-- a BC requester must remain pending and must not receive their own notice.
update public.profiles set role='voluntar' where id<>pg_temp.g521_uid(1) and role in ('bc','moderator');
insert into public.completed_work_requests(requester_id,group_id,description)
values(pg_temp.g521_uid(1),pg_temp.g522_group('Archived #521'),'No other decider #522');
select is((select count(*) from private.request_deciders((select id from public.completed_work_requests where description='No other decider #522'))),0::bigint,'sole BC requester has no eligible decider on archived Group');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($q$select public.reject_completed_work_request((select id from public.completed_work_requests where description='No other decider #522'),'Self')$q$,'42501','request_decide_forbidden','no fallback grants BC self-decision');
reset role;
update public.profiles set role='voluntar' where id=pg_temp.g521_uid(9);
insert into public.member_departments(member_id,dept_id) values(pg_temp.g521_uid(1),'d521');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$insert into g522_ids select 'no-decider',(public.create_completed_work_request('No eligible other decider', 'd521',null,null)).id$q$,'BC requester can file work even when no eligible other decider remains');
reset role;
select is((select count(*) from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='no-decider') and member_id=pg_temp.g521_uid(1)),0::bigint,'filing never sends requester an echo');
reset role;
select is((select count(*) from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='no-decider')),0::bigint,'empty eligible-decider set sends no notification');
select * from finish();
rollback;
