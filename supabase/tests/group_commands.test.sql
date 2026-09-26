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
select lives_ok($$insert into g522_ids select 'task', (public.create_task('Group native',null,now()+interval '1 day','local','direct',p_group_id => pg_temp.g522_group('Project #521'))).id$$,'level-1 Manager creates by Group');
select lives_ok($$insert into g522_ids select 'campaign',(public.create_campaign(pg_temp.g522_group('Project #521'),'Group campaign')).id$$,'Project Manager creates Campaign');
select throws_ok($q$select public.create_task('bad',null,now(),'local','direct')$q$,'PT400','task_group_required','a top-level Task naming no Group is rejected (#579: the Group is the only Origin)');
select throws_ok($q$select public.create_task('bad',null,now(),'local','direct',p_group_id=>-1)$q$,'42501','task_manage_forbidden','unknown Group is nondisclosing for Group Manager');
select lives_ok($q$insert into g522_ids select 'umbrella',(public.create_task('Umbrella',null,null,null,null,p_kind=>'umbrella',p_group_id=>pg_temp.g522_group('Project #521'))).id$q$,'Group-native Umbrella');
select lives_ok($q$insert into g522_ids select 'child',(public.create_task('Child',null,now(),'local','direct',p_parent_task_id=>(select id from g522_ids where name='umbrella'))).id$q$,'Subtask inherits Group without supplied Origin');
select throws_ok($q$select public.create_task('bad',null,now(),'local','direct',p_parent_task_id=>(select id from g522_ids where name='umbrella'),p_group_id=>pg_temp.g522_group('Department #521'))$q$,'PT400','subtask_origin_mismatch','mismatched Subtask Group rejected');
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
select lives_ok($q$select public.create_campaign(pg_temp.dept_group('d521'), 'Legacy Campaign')$q$,'a Department Group Manager creates a Campaign by Group id (#579: the legacy text overload is gone)');
select throws_ok($q$select public.create_campaign(pg_temp.dept_group('missing-522'), 'Hidden')$q$,'42501','campaign_manage_forbidden','a Group that resolves to nothing is nondisclosing');
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
select throws_ok($q$select public.create_task('bad',null,now(),'local','direct',p_group_id=>-1)$q$,'42501','task_manage_forbidden','unknown Group is nondisclosing for BC too');
select lives_ok($q$select public.create_campaign((select id from public.groups where name = 'OSUBB'),'Organization 522')$q$,'BC manages Organization Campaign');
reset role;
select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='child')$q$,'23514','subtask_origin_immutable','Group-only Subtask edit reaches hierarchy trigger');
select lives_ok($q$update public.tasks set campaign_id=(select id from g522_ids where name='campaign') where id=(select id from g522_ids where name='task')$q$,'Project Campaign tags Project Task');
select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='task')$q$,'23514','task_campaign_origin_mismatch','Group-only edit reaches Campaign trigger');
select lives_ok($q$insert into public.tasks(title,deadline,group_id,campaign_id,audience,assignment_mode,status) values('descendant',now(),pg_temp.g522_group('Child #521'),(select id from g522_ids where name='department-campaign'),'local','direct','todo')$q$,'ancestor Campaign tags descendant Task');
select throws_ok($q$insert into public.tasks(title,deadline,group_id,campaign_id,audience,assignment_mode,status) values('ancestor',now(),pg_temp.g522_group('Department #521'),(select id from g522_ids where name='team-campaign'),'local','direct','todo')$q$,'23514','task_campaign_origin_mismatch','descendant Campaign cannot tag ancestor Task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select lives_ok($q$insert into g522_ids select 'request-5',(public.create_completed_work_request('Request #522 5', pg_temp.g522_group('Project #521'))).id$q$,'persona 5 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-5'),'Self')$q$,'42501','request_decide_forbidden','persona 5 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-5')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'deciders for persona 5');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-5') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text,pg_temp.g521_uid(3)::text,pg_temp.g521_uid(4)::text], 'notifications match deciders for persona 5');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($q$insert into g522_ids select 'request-3',(public.create_completed_work_request('Request #522 3', pg_temp.g522_group('Project #521'))).id$q$,'persona 3 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-3'),'Self')$q$,'42501','request_decide_forbidden','persona 3 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-3')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text], 'deciders for persona 3');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-3') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text,pg_temp.g521_uid(2)::text], 'notifications match deciders for persona 3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$insert into g522_ids select 'request-2',(public.create_completed_work_request('Request #522 2', pg_temp.g522_group('Project #521'))).id$q$,'persona 2 files Group-native Request');
select throws_ok($q$select public.reject_completed_work_request((select id from g522_ids where name='request-2'),'Self')$q$,'42501','request_decide_forbidden','persona 2 cannot decide own Request');
reset role;
select set_eq($q$select member::text from private.request_deciders((select id from g522_ids where name='request-2')) member where member::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text], 'deciders for persona 2');
select set_eq($q$select member_id::text from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='request-2') and member_id::text like '52100000-%'$q$,array[pg_temp.g521_uid(1)::text], 'notifications match deciders for persona 2');
insert into public.group_members(group_id,member_id,group_role) values(pg_temp.g522_group('Project #521'),pg_temp.g521_uid(1),'member');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$insert into g522_ids select 'request-1',(public.create_completed_work_request('Request #522 1', pg_temp.g522_group('Project #521'))).id$q$,'persona 1 files Group-native Request');
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
select throws_ok($q$select public.create_completed_work_request('Mixed', null)$q$,'PT400','invalid_origin','a Request naming no Group is malformed (#579: the Group is the only Origin)');
select throws_ok($q$select public.create_completed_work_request('Missing', -1)$q$,'42501','request_origin_forbidden','unknown Request Group is nondisclosing');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select throws_ok($q$select public.create_completed_work_request('Archived', pg_temp.g522_group('Archived #521'))$q$,'42501','request_origin_forbidden','cannot file into archived Group');
reset role;
select pg_temp.test_login(pg_temp.g521_uid(2), '{}'::jsonb);
select throws_ok($q$select public.create_campaign(pg_temp.g522_group('Project #521'),'Claimless')$q$,'42501','campaign_manage_forbidden','claimless Group Manager cannot create Campaign');
select throws_ok($q$select public.create_completed_work_request('Claimless', -1)$q$,'42501','request_command_forbidden','claimless member cannot file Request');
reset role;
-- #579: with the bridge gone a native Group carries Tasks and Requests like any other.
insert into public.groups(name, category, parent_id, path, automatic_membership)
values ('Native #522','team',pg_temp.g522_group('Project #521'),'{}',true);
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$select public.create_task('Native',null,now()+interval '1 day','local','direct',p_group_id=>pg_temp.g522_group('Native #522'))$q$,'a native Group now carries a Task -- task_group_origin_unmapped is gone with the bridge (#579)');
select lives_ok($q$select public.create_campaign(pg_temp.g522_group('Native #522'),'Native Campaign')$q$,'ancestor Manager creates native child Group Campaign');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select lives_ok($q$select public.create_completed_work_request('Native request', pg_temp.g522_group('Native #522'))$q$,'a native Group now carries a Request; Automatic Membership admits the requester (#579)');
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
select throws_ok($q$select public.create_completed_work_request('Down the path #522', pg_temp.g522_group('Child #521'))$q$,
  '42501','request_origin_forbidden','a Department member cannot file into the Department Team below it -- membership does not walk down the path');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($q$select public.create_completed_work_request('Up the path #522', pg_temp.g522_group('Department #521'))$q$,
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
select throws_ok($q$select public.create_campaign((select grp.id from public.groups as grp where grp.name = 'OSUBB'),'BCE org 522')$q$,
  '42501','campaign_manage_forbidden','a Department BCE cannot own an Organization Campaign -- only level >= 6 manages the Organization Group');
reset role;

-- #579: a create by Group id writes exactly that Group -- there is no legacy triple to derive.
select is((select task.group_id from public.tasks as task where task.id=(select id from g522_ids where name='task')),
  pg_temp.g522_group('Project #521'),
  'a create_task by Group id lands on exactly that Group');

-- The writes below are `group_id = <the Group the command decided on>`. Since #579 there is no
-- bridge to derive a Group from a legacy triple, so each command's own write is the only thing
-- that can satisfy tasks.group_id NOT NULL, and both validators see group_id alone.

select throws_ok($q$update public.tasks set group_id=pg_temp.g522_group('Department #521') where id=(select id from g522_ids where name='child')$q$,
  '23514','subtask_origin_immutable','validate_task_hierarchy refuses a Subtask Group change on group_id alone, with no legacy edit to answer for it');
-- `new.group_id is distinct from v_parent_group` is the only rule left to refuse the Subtask.
select throws_ok($q$insert into public.tasks(title,deadline,group_id,parent_task_id,audience,assignment_mode,status,kind)
  values('Mismatch #522',now(),pg_temp.g522_group('Department #521'),
         (select id from g522_ids where name='umbrella'),'local','direct','todo','task')$q$,
  '23514','subtask_origin_mismatch','and refuses a Subtask whose group_id alone differs from its Umbrella''s');

select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($q$insert into g522_ids select 'clone-nobridge',(public.duplicate_task((select id from g522_ids where name='task'),now()+interval '3 days')).id$q$,
  'duplicate_task writes group_id itself: the clone lands with no bridge to derive it');
reset role;
select is((select task.group_id from public.tasks as task where task.id=(select id from g522_ids where name='clone-nobridge')),
  pg_temp.g522_group('Project #521'),'and it is the source Group, written by the command rather than derived');

select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$select public.approve_completed_work_request((select id from g522_ids where name='request-5'),3,3,'No bridge #522')$q$,
  'approve_completed_work_request writes the new Task''s group_id itself: it lands with no bridge to derive it');
reset role;
select is((select task.group_id from public.completed_work_requests as request
             join public.tasks as task on task.id=request.task_id
            where request.id=(select id from g522_ids where name='request-5')),
  pg_temp.g522_group('Project #521'),'and it is the Request''s Group, written by the command rather than derived');

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
update public.group_members set group_role='member'
 where group_id=pg_temp.dept_group('d521') and member_id=pg_temp.g521_uid(9);
insert into pg_temp.fixture_member_departments(member_id,dept_id) values(pg_temp.g521_uid(1),'d521');
insert into public.group_members(group_id,member_id,group_role)
values(pg_temp.dept_group('d521'),pg_temp.g521_uid(1),'member');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($q$insert into g522_ids select 'no-decider',(public.create_completed_work_request('No eligible other decider', pg_temp.dept_group('d521'))).id$q$,'BC requester can file work even when no eligible other decider remains');
reset role;
select is((select count(*) from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='no-decider') and member_id=pg_temp.g521_uid(1)),0::bigint,'filing never sends requester an echo');
reset role;
select is((select count(*) from public.notifications where dedupe_key='request:'||(select id from g522_ids where name='no-decider')),0::bigint,'empty eligible-decider set sends no notification');
select * from finish();
rollback;
