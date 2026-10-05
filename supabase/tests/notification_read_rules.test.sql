-- #1012 (ruling R37, amends R16): a Notification is read when its Member
-- opens or acts on what it is about, and BCE, BC and the Moderator may mark
-- every Notification of theirs read at once.
--
--   1. Subjects: private.notification_subject derives the thing a row is
--      about; the before-insert trigger stores it; "Cerere respinsă" now
--      names its Request.
--   2. public.mark_notifications_read_for(subject): the caller's own unread
--      rows about one subject, nobody else's; malformed subjects PT400;
--      claimless and inactive 42501.
--   3. public.mark_all_notifications_read(): live level >= 5 only, own rows.
--   4. Acting marks the ACTOR's own rows, never another decider's copy:
--      an Application decided, a Completed-work Request rejected, a Promotion
--      Candidate rejected, an RSVP, a Task activity row.
--
-- Fixture prefix 10120000-0000-0000-0000-0000000000NN.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(62);

-- Personas: 1 BC, 2 Moderator, 3 BCE, 4 Voluntar cu Drept de Vot (level 3),
-- 5 Voluntar (member of Root #1012: requester, applicant, RSVPs),
-- 6 and 7 Responsibles of Root #1012 (two deciders), 8 an inactive BC,
-- 9 a Voluntar who applies to Root #1012.
create function pg_temp.u1012(n integer) returns uuid language sql immutable as $$
  select ('10120000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u1012(n), 'citire.' || n || '.1012@test.local' from generate_series(1, 9) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u1012(n), 'Citire #1012 ' || n, 'citire.' || n || '.1012@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 3 then 'bce' when 4 then 'vot'
          when 8 then 'bc' else 'voluntar' end)::member_role,
  (case when n = 8 then 'inactiv' else 'activ' end)::member_status
from generate_series(1, 9) n;

insert into groups(name, category, min_level, accepts_applications, application_level)
values ('Root #1012', 'team', 0, true, 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u1012(roster.n), roster.role
  from (values (5, 'member'), (6, 'responsible'), (7, 'responsible')) as roster(n, role)
  join groups as grp on grp.name = 'Root #1012';

create temp table fx as
select (select id from groups where name = 'Root #1012') as root;
grant select on fx to authenticated;

-- Acting as a caller without leaving the owner role: the triggers read
-- auth.uid() from the claims, as they do under a real command.
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true)::void;
$$;

create function pg_temp.unread(p_member integer, p_subject text) returns bigint
language sql as $$
  select count(*) from public.notifications
   where member_id = pg_temp.u1012(p_member) and subject = p_subject and not read
$$;

-- A raw Notification row with an explicit subject.
create function pg_temp.notice(p_member integer, p_subject text, p_title text default 'Fixture #1012')
returns void language sql as $$
  insert into public.notifications(member_id, kind, title, subject)
  values (pg_temp.u1012(p_member), 'system', p_title, p_subject);
$$;

-- ==================== 1. Subjects ====================
select has_column('public', 'notifications', 'subject', 'notifications.subject exists');
select has_index('public', 'notifications', 'notifications_member_subject_unread_idx',
  'a Member''s unread rows about one subject are indexed');

select is(private.notification_subject(42, 'task:42:queue', '/tracker?task=42'), 'task:42',
  'a Task Notification is about task:<id>');
select is(private.notification_subject(null, 'event:7:schedule', '/calendar?event=7'), 'event:7',
  'an Event change, keyed per field, is about event:<id>');
select is(private.notification_subject(null, 'announcement:3', null), 'announcement:3',
  'an Anunț nou is about announcement:<id>');
select is(private.notification_subject(null, 'request:9', '/cereri'), 'completed_work_request:9',
  'a Request Notification is about completed_work_request:<id>');
select is(private.notification_subject(null, 'application:5', null), 'group_application:5',
  'an Application Notification is about group_application:<id>');
select is(private.notification_subject(null, 'promotion_candidate:live:' || pg_temp.u1012(5)::text, null),
  'promotion_candidate:' || pg_temp.u1012(5)::text,
  'a live Promotion Candidate is about promotion_candidate:<member>');
select is(private.notification_subject(null, 'promotion_candidate:12:' || pg_temp.u1012(5)::text, null),
  'promotion_candidate:' || pg_temp.u1012(5)::text,
  'a run''s Promotion Candidate is about the same promotion_candidate:<member>');
select is(private.notification_subject(null, 'retention_signal:12:' || pg_temp.u1012(5)::text, null),
  'retention_signal:' || pg_temp.u1012(5)::text,
  'a Retention Signal is about retention_signal:<member>');
select is(private.notification_subject(null, null, '/tracker/31'), 'task:31',
  'a row linked before #843 (/tracker/<id>) is about its Task');
select is(private.notification_subject(null, null, '/anunturi?anunt=8'), 'announcement:8',
  'an unkeyed Anunț nou is about its Announcement through its link');
select is(private.notification_subject(null, 'push_health:2026-10-05', '/profil'), null,
  'a Notification about nothing but itself has no subject');

select private.notify(array[pg_temp.u1012(5)], 'event', 'Eveniment actualizat: Fixture', 'Corp',
  null, null, null, '/calendar?event=55');
select is((select subject from notifications where member_id = pg_temp.u1012(5) and title = 'Eveniment actualizat: Fixture'),
  'event:55', 'the insert trigger stores the subject private.notify''s row is about');
insert into notifications(member_id, kind, title, link, subject)
values (pg_temp.u1012(5), 'system', 'Explicit subject', '/calendar?event=56', 'event:57');
select is((select subject from notifications where title = 'Explicit subject'), 'event:57',
  'a subject the writer set is kept');

-- ==================== 2. mark_notifications_read_for ====================
select pg_temp.notice(5, 'task:901', 'Mine A');
select pg_temp.notice(5, 'task:901', 'Mine B');
select pg_temp.notice(5, 'task:902', 'Mine other subject');
select pg_temp.notice(6, 'task:901', 'Theirs');

select pg_temp.test_login_leadership(pg_temp.u1012(5));
select is(public.mark_notifications_read_for('task:901'), 2,
  'opening a Task marks the caller''s two unread Notifications about it');
select is(public.mark_notifications_read_for('task:901'), 0,
  'opening it again marks nothing more');
reset role;
select is(pg_temp.unread(6, 'task:901'), 1::bigint,
  'another Member''s Notification about the same Task stays unread');
select is(pg_temp.unread(5, 'task:902'), 1::bigint,
  'the caller''s Notification about another subject stays unread');

select pg_temp.test_login_leadership(pg_temp.u1012(5));
select throws_ok($$select public.mark_notifications_read_for('nonsense')$$,
  'PT400', 'invalid_subject', 'an unknown subject shape is refused');
select throws_ok($$select public.mark_notifications_read_for(null)$$,
  'PT400', 'invalid_subject', 'a null subject is refused');
select throws_ok($$select public.mark_notifications_read_for('task:0')$$,
  'PT400', 'invalid_subject', 'a subject id must be a positive number');
select throws_ok($$select public.mark_notifications_read_for('promotion_candidate:abc')$$,
  'PT400', 'invalid_subject', 'a member subject needs a uuid');
select throws_ok($$select public.mark_notifications_read_for('task')$$,
  'PT400', 'invalid_subject', 'only promotion_candidate may be named without an id');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.mark_notifications_read_for('task:902')$$,
  '42501', 'notification_read_forbidden', 'a claimless session is refused');
reset role;
select pg_temp.notice(8, 'task:902', 'Inactive');
select pg_temp.test_login_leadership(pg_temp.u1012(8));
select throws_ok($$select public.mark_notifications_read_for('task:902')$$,
  '42501', 'notification_read_forbidden', 'a deactivated Member is refused');
reset role;
select is(pg_temp.unread(8, 'task:902'), 1::bigint, 'the deactivated Member''s row is untouched');
select ok(not has_function_privilege('anon', 'public.mark_notifications_read_for(text)', 'execute'),
  'anon cannot call mark_notifications_read_for');

-- The Promotion Candidates list reads every candidate at once.
select pg_temp.notice(1, 'promotion_candidate:' || pg_temp.u1012(5)::text, 'Candidate 5');
select pg_temp.notice(1, 'promotion_candidate:' || pg_temp.u1012(9)::text, 'Candidate 9');
select pg_temp.notice(1, 'task:903', 'BC task');
select pg_temp.notice(2, 'promotion_candidate:' || pg_temp.u1012(5)::text, 'Moderator candidate 5');
select pg_temp.test_login_leadership(pg_temp.u1012(1));
select is(public.mark_notifications_read_for('promotion_candidate'), 2,
  'opening the Promotion Candidates list reads every candidate Notification of the caller');
reset role;
select is(pg_temp.unread(1, 'task:903'), 1::bigint, 'the list leaves other subjects unread');
select is(pg_temp.unread(2, 'promotion_candidate:' || pg_temp.u1012(5)::text), 1::bigint,
  'the list leaves the Moderator''s copy unread');

-- ==================== 3. mark_all_notifications_read ====================
select pg_temp.notice(3, 'task:904', 'BCE one');
select pg_temp.notice(3, null, 'BCE two');
select pg_temp.notice(4, 'task:904', 'Vot one');

select pg_temp.test_login_leadership(pg_temp.u1012(4));
select throws_ok($$select public.mark_all_notifications_read()$$,
  '42501', 'notification_mark_all_forbidden', 'a Voluntar cu Drept de Vot (level 3) may not mark all');
reset role;
-- A token still claiming BC's level does not open it: the gate reads the
-- live Profile.
select pg_temp.test_login(pg_temp.u1012(4),
  jsonb_build_object('member_role', 'bc', 'member_level', 6, 'group_ids', '[]'::jsonb));
select throws_ok($$select public.mark_all_notifications_read()$$,
  '42501', 'notification_mark_all_forbidden', 'a stale token''s level does not open mark-all');
reset role;
select is((select count(*) from notifications where member_id = pg_temp.u1012(4) and not read), 1::bigint,
  'the refused caller''s rows stay unread');

select pg_temp.test_login_leadership(pg_temp.u1012(3));
select is(public.mark_all_notifications_read(), 2, 'BCE marks every unread Notification of theirs');
reset role;
select is((select count(*) from notifications where member_id = pg_temp.u1012(3) and not read), 0::bigint,
  'nothing of BCE''s is left unread');
select is((select count(*) from notifications where member_id = pg_temp.u1012(4) and not read), 1::bigint,
  'mark-all never reaches another Member''s rows');

select pg_temp.test_login_leadership(pg_temp.u1012(2));
select ok(public.mark_all_notifications_read() >= 1, 'the Moderator may mark all');
reset role;
select pg_temp.test_login_leadership(pg_temp.u1012(8));
select throws_ok($$select public.mark_all_notifications_read()$$,
  '42501', 'notification_mark_all_forbidden', 'a deactivated BC may not mark all');
reset role;
select ok(not has_function_privilege('anon', 'public.mark_all_notifications_read()', 'execute'),
  'anon cannot call mark_all_notifications_read');

-- ==================== 4. Acting reads the actor's own ====================
-- 4a. An Application decided by one Responsible.
select pg_temp.test_login_leadership(pg_temp.u1012(9));
select lives_ok(format($$select public.apply_to_group(%s, null)$$, (select root from fx)),
  'a Voluntar applies to Root #1012');
reset role;
create temp table fx_app as
select id from group_applications where member_id = pg_temp.u1012(9);
grant select on fx_app to authenticated;
select is(pg_temp.unread(6, 'group_application:' || (select id from fx_app)::text)
        + pg_temp.unread(7, 'group_application:' || (select id from fx_app)::text), 2::bigint,
  'both Responsibles hold an unread "Cerere de înscriere" about the Application');
select pg_temp.test_login_leadership(pg_temp.u1012(6));
select lives_ok(format($$select public.decide_group_application(%s, true, null)$$, (select id from fx_app)),
  'one Responsible accepts the Application');
reset role;
select is(pg_temp.unread(6, 'group_application:' || (select id from fx_app)::text), 0::bigint,
  'deciding an Application reads the decider''s own "Cerere de înscriere"');
select is(pg_temp.unread(7, 'group_application:' || (select id from fx_app)::text), 1::bigint,
  'the other Responsible''s copy stays unread');

-- 4b. A Completed-work Request rejected by one Responsible.
select pg_temp.test_login_leadership(pg_temp.u1012(5));
select lives_ok(format($$select public.create_completed_work_request('Am ajutat la stand #1012', %s)$$, (select root from fx)),
  'a Voluntar files a Completed-work Request');
reset role;
create temp table fx_req as
select id from completed_work_requests where requester_id = pg_temp.u1012(5);
grant select on fx_req to authenticated;
select is(pg_temp.unread(6, 'completed_work_request:' || (select id from fx_req)::text)
        + pg_temp.unread(7, 'completed_work_request:' || (select id from fx_req)::text), 2::bigint,
  'both deciders hold an unread "Cerere nouă" about the Request');
select pg_temp.test_login_leadership(pg_temp.u1012(6));
select lives_ok(format($$select public.reject_completed_work_request(%s, 'Nu e muncă de voluntariat')$$, (select id from fx_req)),
  'one decider rejects the Request');
reset role;
select is(pg_temp.unread(6, 'completed_work_request:' || (select id from fx_req)::text), 0::bigint,
  'deciding a Request reads the decider''s own "Cerere nouă"');
select is(pg_temp.unread(7, 'completed_work_request:' || (select id from fx_req)::text), 1::bigint,
  'the other decider''s copy stays unread');
select is((select subject from notifications
            where member_id = pg_temp.u1012(5) and title like 'Cerere respinsă:%'),
  'completed_work_request:' || (select id from fx_req)::text,
  '"Cerere respinsă" names its Request, so opening the Request reads it');

-- 4c. A Promotion Candidate rejected by BC; the Moderator's copy stays.
insert into promotion_candidates(member_id, task_points, tenure_since, threshold_used)
values (pg_temp.u1012(9), 50, current_date - 400, 10);
create temp table fx_cand as
select id from promotion_candidates where member_id = pg_temp.u1012(9) and decision is null;
grant select on fx_cand to authenticated;
-- 1's and 2's copies for candidate 9: 1's was read by the list above, so add fresh ones.
select pg_temp.notice(1, 'promotion_candidate:' || pg_temp.u1012(9)::text, 'Candidate 9 again');
select pg_temp.notice(2, 'promotion_candidate:' || pg_temp.u1012(9)::text, 'Moderator candidate 9');
select pg_temp.test_login_leadership(pg_temp.u1012(1));
select lives_ok(format($$select public.reject_promotion_candidate(%s, 'Încă nu')$$, (select id from fx_cand)),
  'BC rejects the Promotion Candidate');
reset role;
select is(pg_temp.unread(1, 'promotion_candidate:' || pg_temp.u1012(9)::text), 0::bigint,
  'deciding a Promotion Candidate reads the decider''s own Notification about it');
select is(pg_temp.unread(2, 'promotion_candidate:' || pg_temp.u1012(9)::text), 1::bigint,
  'the Moderator''s copy stays unread');

-- 4d. An RSVP; a manager recording someone else's attendance marks nothing.
insert into events(title, type, starts_at, group_id)
values ('Ședință #1012', 'sedinta', now() + interval '3 days', (select root from fx));
create temp table fx_event as select id from events where title = 'Ședință #1012';
grant select on fx_event to authenticated;
select pg_temp.notice(5, 'event:' || (select id from fx_event)::text, 'Event for 5');
select pg_temp.notice(6, 'event:' || (select id from fx_event)::text, 'Event for 6');
select pg_temp.notice(7, 'event:' || (select id from fx_event)::text, 'Event for 7');
select pg_temp.test_login_leadership(pg_temp.u1012(5));
select lives_ok(format($$select public.set_event_rsvp(%s, 'going')$$, (select id from fx_event)),
  'the Voluntar RSVPs');
reset role;
select is(pg_temp.unread(5, 'event:' || (select id from fx_event)::text), 0::bigint,
  'an RSVP reads the Member''s own Notifications about the Event');
select is(pg_temp.unread(6, 'event:' || (select id from fx_event)::text), 1::bigint,
  'another Member''s Notification about the Event stays unread');
select pg_temp.act_as(pg_temp.u1012(6));
insert into event_attendance(event_id, member_id, status)
values ((select id from fx_event), pg_temp.u1012(7), 'going');
select pg_temp.test_clear_jwt();
select is(pg_temp.unread(7, 'event:' || (select id from fx_event)::text), 1::bigint,
  'attendance written for someone else marks none of their Notifications');

-- 4e. A Task's activity rows: the actor's own, the Task itself only.
insert into tasks(title, group_id) values ('Task #1012', (select root from fx));
insert into tasks(title, group_id) values ('Alt task #1012', (select root from fx));
create temp table fx_task as
select (select id from tasks where title = 'Task #1012') as t1,
       (select id from tasks where title = 'Alt task #1012') as t2;
select pg_temp.notice(6, 'task:' || (select t1 from fx_task)::text, 'De verificat 6');
select pg_temp.notice(7, 'task:' || (select t1 from fx_task)::text, 'De verificat 7');
select pg_temp.notice(6, 'task:' || (select t2 from fx_task)::text, 'Umbrella 6');

select pg_temp.act_as(pg_temp.u1012(6));
insert into task_activity(task_id, kind, actor_id)
values ((select t2 from fx_task), 'subtask_completed', pg_temp.u1012(6)),
       ((select t2 from fx_task), 'created', pg_temp.u1012(6));
insert into task_activity(task_id, kind, actor_id, details)
values ((select t2 from fx_task), 'cancelled', pg_temp.u1012(6),
        jsonb_build_object('cascade_from', (select t1 from fx_task)));
select is(pg_temp.unread(6, 'task:' || (select t2 from fx_task)::text), 1::bigint,
  'side rows on another Task (subtask_completed, created, a cascade) mark nothing');
select pg_temp.act_as(pg_temp.u1012(7));
insert into task_activity(task_id, kind, actor_id)
values ((select t1 from fx_task), 'returned_to_progress', pg_temp.u1012(6));
select is(pg_temp.unread(6, 'task:' || (select t1 from fx_task)::text), 1::bigint,
  'an activity row whose actor is not the caller marks nothing');
select pg_temp.act_as(pg_temp.u1012(6));
insert into task_activity(task_id, kind, actor_id)
values ((select t1 from fx_task), 'evaluated', pg_temp.u1012(6));
select is(pg_temp.unread(6, 'task:' || (select t1 from fx_task)::text), 0::bigint,
  'evaluating a Task reads the reviewer''s own Notifications about it');
select is(pg_temp.unread(7, 'task:' || (select t1 from fx_task)::text), 1::bigint,
  'the other manager''s "De verificat" stays unread');
select pg_temp.test_clear_jwt();

select * from finish();
rollback;
