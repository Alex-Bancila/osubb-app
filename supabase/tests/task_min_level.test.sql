-- R57 (Alex, 2026-10-14): a public Task's Minimum Level -- the lowest Level
-- that sees it as an Opportunity or through Shared Work Visibility and may join
-- its Candidate Queue. Never a gate on a Group Role on the path, BCE and above,
-- or one's own history. Spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(62);

create function pg_temp.m(n integer) returns uuid language sql immutable as $$
  select ('57100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- 1 recrut, 2 voluntar, 3 activ, 4 bc, 5 activ (Manager), 6 recrut (Responsible),
-- 7 voluntar and 8 recrut (Shared Work Visibility), 9 recrut (nothing to do with it).
insert into auth.users(id, email)
select pg_temp.m(n), 'level.' || n || '.57@test.local' from generate_series(1, 9) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.m(n), 'Level #57 ' || n, 'level.' || n || '.57@test.local',
       (case n when 1 then 'recrut' when 2 then 'voluntar' when 3 then 'activ' when 4 then 'bc'
               when 5 then 'activ' when 6 then 'recrut' when 7 then 'voluntar' else 'recrut' end)::member_role,
       'activ'::member_status
  from generate_series(1, 9) n;
insert into groups(name, category, min_level, shared_work_visibility) values
  ('Min #57', 'team', 0, false), ('Shared #57', 'team', 0, true),
  ('Floor #57', 'team', 1, false), ('Card #57', 'team', 0, false);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.m(roster.n), roster.role
  from (values ('Min #57', 5, 'manager'), ('Min #57', 4, 'manager'), ('Min #57', 6, 'responsible'),
               ('Min #57', 1, 'member'), ('Min #57', 2, 'member'), ('Min #57', 3, 'member'),
               ('Shared #57', 5, 'manager'), ('Shared #57', 7, 'member'), ('Shared #57', 8, 'member'),
               ('Floor #57', 5, 'manager'), ('Floor #57', 2, 'member'), ('Floor #57', 3, 'member'),
               ('Card #57', 4, 'manager')) as roster(grp, n, role)
  join groups as grp on grp.name = roster.grp;
-- The roster refuses a member below the level, so Card #57 rises afterwards.
update groups set min_level = 3 where name = 'Card #57';
create function pg_temp.g(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.t(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
create function pg_temp.reads(p_member integer, p_title text) returns integer language plpgsql as $$
declare v_count integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.m(p_member));
  select count(*)::int into v_count from public.tasks where title = p_title;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_count;
end;
$$;

insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level) values
  ('Org V #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1),
  ('Org R #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 0),
  ('Local A #57',  pg_temp.g('Floor #57'),  '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), 2),
  ('Card V #57',   pg_temp.g('Card #57'),   '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1);
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Shared V #57', pg_temp.g('Shared #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);
insert into tasks (title, group_id, status, kind, audience, assignment_mode)
values ('Umb #57', pg_temp.g('Shared #57'), 'todo', 'umbrella', null, null);
insert into tasks (title, group_id, parent_task_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Sub V #57', pg_temp.g('Shared #57'), pg_temp.t('Umb #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);

-- ==================== Who reads ====================
select is(pg_temp.reads(2, 'Org V #57'), 1, 'an org-wide Opportunity at Voluntar reaches a Voluntar');
select is(pg_temp.reads(1, 'Org V #57'), 0, '... and not a Recrut');
select is(pg_temp.reads(1, 'Org R #57'), 1, 'at Recrut it still reaches everyone (R26 kept)');
select is(pg_temp.reads(2, 'Local A #57'), 0, 'a local one at Voluntar Activ is hidden from a Voluntar member');
select is(pg_temp.reads(3, 'Local A #57'), 1, '... and read by a Voluntar Activ member');
select is(pg_temp.reads(7, 'Shared V #57'), 1, 'Shared Work Visibility shows it at the Role');
select is(pg_temp.reads(8, 'Shared V #57'), 0, '... and hides it below the Role');
select is(pg_temp.reads(8, 'Umb #57'), 1, 'the Umbrella is read through Shared Work Visibility');
select is(pg_temp.reads(8, 'Sub V #57'), 0, 'its Subtask above the Role stays hidden (judged on the Task itself)');
select is(pg_temp.reads(7, 'Sub V #57'), 1, '... and shows at the Role');
select is(pg_temp.reads(6, 'Org V #57'), 1, 'a Group Responsible below the Role still reads it (R3)');
select is(pg_temp.reads(4, 'Org V #57'), 1, 'BC reads it (R1)');
select pg_temp.test_login_leadership(pg_temp.m(8));
select is(private.can_read_task(pg_temp.t('Sub V #57')), false, 'can_read_task agrees: hidden below the Role');
select pg_temp.test_login_leadership(pg_temp.m(7));
select is(private.can_read_task(pg_temp.t('Sub V #57')), true, 'can_read_task agrees: read at the Role');
reset role;
select pg_temp.test_clear_jwt();
-- The Group card: Card #57 sits at level 3; its only org Opportunity at Voluntar.
select pg_temp.test_login_leadership(pg_temp.m(2));
select is((select count(*)::int from groups where name = 'Card #57'), 1,
  'a Voluntar reads the Group of an Opportunity they may see');
select pg_temp.test_login_leadership(pg_temp.m(1));
select is((select count(*)::int from groups where name = 'Card #57'), 0, '... a Recrut does not');
reset role;
select pg_temp.test_clear_jwt();
-- A past Candidate keeps reading it (R2).
insert into task_candidates (task_id, member_id, status, joined_at, decided_at, decided_by)
values (pg_temp.t('Org V #57'), pg_temp.m(1), 'withdrawn', now(), now(), pg_temp.m(1));
select is(pg_temp.reads(1, 'Org V #57'), 1, 'a past Candidate below the Role still reads it');
select throws_ok($$insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, min_level)
  values ('Direct #57', (select id from groups where name = 'Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'direct', 1)$$,
  '23514', null, 'a direct Task carries no Minimum Level (tasks_min_level_public_ck)');

-- ==================== Joining ====================
select pg_temp.test_login_leadership(pg_temp.m(6));
select throws_ok($$select public.express_task_interest((select id from tasks where title = 'Org V #57'))$$,
  '42501', 'task_level_forbidden', 'a reader below the Role (a Group Responsible) cannot join');
select pg_temp.test_login_leadership(pg_temp.m(1));
select throws_ok($$select public.express_task_interest((select id from tasks where title = 'Org V #57'))$$,
  '42501', 'task_level_forbidden', 'nor can a withdrawn Candidate below the Role, who still reads it');
select pg_temp.test_login_leadership(pg_temp.m(9));
select throws_ok($$select public.express_task_interest(pg_temp.t('Org V #57'))$$,
  'PT404', 'task_not_found', 'anyone else does not even see it');
select pg_temp.test_login_leadership(pg_temp.m(2));
select lives_ok($$select public.express_task_interest((select id from tasks where title = 'Org V #57'))$$,
  'a Voluntar joins it');

-- ==================== Creating ====================
select pg_temp.test_login_leadership(pg_temp.m(5));
select lives_ok($$select public.create_task(p_title := 'Made A #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'a Manager makes a Task for Voluntar Activ and up');
select throws_ok($$select public.create_task(p_title := 'Too high #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 3)$$,
  'PT400', 'task_min_level_above_actor', 'never above the creator''s own Level');
select throws_ok($$select public.create_task(p_title := 'Off #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 4)$$,
  'PT400', 'invalid_task_min_level', 'only the ladder');
select lives_ok($$select public.create_task(p_title := 'Made D #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'local', p_assignment_mode := 'direct',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'a direct Task ignores the Role sent');
select lives_ok($$select public.create_task(p_title := 'Made U #57', p_description := null,
  p_deadline := null, p_audience := null, p_assignment_mode := null, p_kind := 'umbrella',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'so does an Umbrella');
select lives_ok($$select public.create_tasks(p_title := 'Copies #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_copies := 3, p_min_level := 1)$$,
  'copies made in one go');
select lives_ok($$select public.duplicate_task((select id from tasks where title = 'Made A #57'), '2030-11-27 18:00+02')$$,
  'a duplicate');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Made A #57' and duplicated_from_task_id is null), 2, 'stored at Voluntar Activ');
select is((select min_level from tasks where title = 'Made D #57'), 0, 'the direct Task is stored at 0');
select is((select min_level from tasks where title = 'Made U #57'), 0, 'the Umbrella is stored at 0');
select is((select array_agg(min_level order by id) from tasks where title = 'Copies #57'), array[1, 1, 1], 'every copy carries it');
select is((select min_level from tasks where duplicated_from_task_id = (select id from tasks where title = 'Made A #57' and duplicated_from_task_id is null)), 2,
  'the duplicate copies it');

-- ==================== Editing ====================
create function pg_temp.edit(p_title text, p_min integer, p_accept boolean,
                             p_mode text default 'public', p_audience text default 'org',
                             p_group text default null, p_new_title text default null)
returns public.tasks language sql as $$
  select public.update_task(p_task_id := task.id,
           p_group_id := coalesce((select id from public.groups where name = p_group), task.group_id),
           p_title := coalesce(p_new_title, task.title), p_description := task.description,
           p_deadline := task.deadline, p_campaign_id := task.campaign_id,
           p_assignment_mode := p_mode, p_audience := p_audience,
           p_accept_consequences := p_accept, p_links := task.links, p_min_level := p_min)
    from public.tasks as task where task.title = p_title
$$;
create function pg_temp.preview(p_title text, p_min integer, p_group text default null)
returns text[] language sql as $$
  select array_agg(c.consequence || ':' || c.member_id::text order by c.consequence, c.member_id::text)
    from public.tasks as task
   cross join lateral public.preview_task_update(p_task_id := task.id,
           p_group_id := coalesce((select id from public.groups where name = p_group), task.group_id),
           p_title := task.title, p_description := task.description, p_deadline := task.deadline,
           p_campaign_id := task.campaign_id, p_assignment_mode := task.assignment_mode,
           p_audience := task.audience, p_links := task.links, p_min_level := p_min) as c
   where task.title = p_title
$$;
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level) values
  ('Edit #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0),
  ('High #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0),
  ('Move #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0);
-- The queue of Edit #57: a Recrut and a Voluntar Activ wait; a Voluntar executes.
select pg_temp.test_login_leadership(pg_temp.m(1));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(2));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(3));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(7));
select public.express_task_interest(pg_temp.t('Move #57'));
select pg_temp.test_login_leadership(pg_temp.m(5));
select public.select_task_candidate(pg_temp.t('Edit #57'),
  (select id from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(2)), false);
select public.select_task_candidate(pg_temp.t('Move #57'),
  (select id from task_candidates where task_id = pg_temp.t('Move #57') and member_id = pg_temp.m(7)), false);

select is(pg_temp.preview('Edit #57', 2),
  array['candidate_removed:' || pg_temp.m(1), 'executor_removed:' || pg_temp.m(2)],
  'raising it removes the waiting Recrut and the Voluntar Executor, nobody at the Role');
select throws_ok($$select pg_temp.edit('Edit #57', 2, false)$$, 'PT409', 'task_update_needs_confirmation',
  'not without confirmation');
select lives_ok($$select pg_temp.edit('Edit #57', 2, true)$$, 'confirmed, it applies');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Edit #57'), 2, 'stored at Voluntar Activ');
select is((select status from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(1)), 'closed',
  'the Recrut''s Candidature is closed');
select is((select count(*)::int from task_assignments where task_id = pg_temp.t('Edit #57')
            and member_id = pg_temp.m(2) and ended_at is null), 0, 'the Voluntar is no longer the Executor');
select is((select count(*)::int from notifications where member_id = pg_temp.m(2)
            and title = 'Task actualizat: Edit #57'
            and body = 'Nu mai ești executorul acestui task: e acum doar pentru Voluntar Activ și peste.'), 1,
  'the removed Executor is told why');
select is((select status from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(3)), 'pending',
  'the Voluntar Activ still waits');

select pg_temp.test_login_leadership(pg_temp.m(5));
select is(pg_temp.preview('Edit #57', 0), null::text[], 'lowering it removes nobody');
select public.select_task_candidate(pg_temp.t('Edit #57'),
  (select id from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(3)), false);
select lives_ok($$select pg_temp.edit('Edit #57', 1, false)$$, 'lowered to Voluntar, nothing to confirm');
select lives_ok($$select pg_temp.edit('Edit #57', null, false, p_new_title := 'Edit 2 #57')$$,
  'an edit that does not send the Role');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Edit 2 #57'), 1, 'null keeps it (an older app changes nothing)');
select is((select count(*)::int from notifications where member_id = pg_temp.m(3)
            and title = 'Task actualizat: Edit #57' and body = 'Modificat: cine îl vede.'), 1,
  'the Executor''s edit notice names the Role');

-- An unchanged Role above the editor's Level is never judged; a changed one is.
select pg_temp.test_login_leadership(pg_temp.m(4));
select lives_ok($$select pg_temp.edit('High #57', 6, false)$$, 'BC sets it to BC');
select pg_temp.test_login_leadership(pg_temp.m(5));
select lives_ok($$select pg_temp.edit('High #57', 6, false, p_new_title := 'High 2 #57')$$,
  'a Manager below it still edits the rest');
select throws_ok($$select pg_temp.edit('High 2 #57', 5, false)$$, 'PT400', 'task_min_level_above_actor',
  'but cannot choose another Role above their own');
select throws_ok($$select pg_temp.edit('High 2 #57', 4, false)$$, 'PT400', 'invalid_task_min_level',
  'an edit takes only the ladder');
select throws_ok($$select pg_temp.edit('High 2 #57', 2, false)$$, 'PT400', 'task_min_level_above_actor',
  'nor lower a Role above their own');
select throws_ok($$select pg_temp.edit('High 2 #57', 6, false, p_mode := 'direct', p_audience := 'local')$$,
  'PT400', 'task_min_level_above_actor', 'nor clear it by making the Task Direct');
select pg_temp.test_login_leadership(pg_temp.m(4));
select lives_ok($$select pg_temp.edit('High 2 #57', 6, false, p_mode := 'direct', p_audience := 'local')$$,
  'BC makes it Direct with the Role still sent');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'High 2 #57'), 0, 'a direct Task is stored at 0');

-- Moving and raising at once: one consequence for the Executor.
select pg_temp.test_login_leadership(pg_temp.m(5));
select is(pg_temp.preview('Move #57', 2, 'Floor #57'), array['executor_removed:' || pg_temp.m(7)],
  'a Voluntar Executor moved into a Voluntar Group but below the new Role is only removed');
reset role;
select pg_temp.test_clear_jwt();
select is(private.task_field_labels(array['min_level']), 'cine îl vede', 'the change has a Romanian label');

-- The removed Executor hears the reason that is theirs, judged per person
-- (final review of R57): a move and a raise at once, a narrowing and a raise.
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level)
values ('Narrow #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0);
select pg_temp.test_login_leadership(pg_temp.m(7));
select public.express_task_interest(pg_temp.t('Narrow #57'));
select pg_temp.test_login_leadership(pg_temp.m(5));
select public.select_task_candidate(pg_temp.t('Narrow #57'),
  (select id from task_candidates where task_id = pg_temp.t('Narrow #57') and member_id = pg_temp.m(7)), false);
select lives_ok($$select pg_temp.edit('Move #57', 2, true, p_group := 'Floor #57')$$, 'moved and raised at once');
select lives_ok($$select pg_temp.edit('Narrow #57', 1, true, p_audience := 'local')$$, 'narrowed and raised at once');
reset role;
select pg_temp.test_clear_jwt();
select is((select body from notifications where member_id = pg_temp.m(7) and title = 'Task actualizat: Move #57'),
  'Nu mai ești executorul acestui task: e acum doar pentru Voluntar Activ și peste.',
  'moved into a Group they may join but below the new Role: told it is the Role');
select is((select end_reason from task_assignments where task_id = pg_temp.t('Move #57') and member_id = pg_temp.m(7)),
  'task_updated', '... and the Assignment ends as an edit, not a move');
select is((select body from notifications where member_id = pg_temp.m(7) and title = 'Task actualizat: Narrow #57'),
  'Nu mai ești executorul acestui task: audiența lui s-a schimbat.',
  'removed by a narrower Audience while at or above the new Role: told it is the Audience');

select * from finish();
rollback;
