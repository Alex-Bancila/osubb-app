-- #626: public.update_task / public.preview_task_update -- a Task Manager
-- edits every Task field until review (ADR-0007 Sec Task identity, amended
-- 2026-09-21), and the consequences the edit has for other people come from
-- ONE shared definition read by both the preview and the command (R-E2).
--
-- Sections: 1 API shape; 2 every field in todo / in_progress / Feedback
-- pending; 3 refusals (in_review, terminal, nothing_to_update, umbrella,
-- input); 4 authority; 5 Public -> Direct; 6 Direct -> Public; 7 R-E8
-- Audience narrowing; 8 preview writes nothing.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(119);

-- ==================== Fixtures ====================
create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('62600000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- 1 manager (BCE in edu -> Manager of the edu Group); 2 exec_in, 4 cand_in,
-- 7 cand_in2 (edu members); 3 exec_out, 5 cand_out, 6 cand_out2, 8 outsider
-- (no membership at all).
insert into auth.users (id, email)
select pg_temp.u(n), 'member.' || n || '.626@test.local' from generate_series(1, 8) as n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Membru 626 ' || n, 'member.' || n || '.626@test.local',
       (case when n = 1 then 'bce' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 8) as n;
insert into public.member_departments (member_id, dept_id) values
  (pg_temp.u(1), 'edu'), (pg_temp.u(2), 'edu'), (pg_temp.u(4), 'edu'), (pg_temp.u(7), 'edu');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campanie #626', true, pg_temp.u(1)),
  (pg_temp.dept_group('pr'), 'Campanie PR #626', true, pg_temp.u(1));

create temp table f626 as
select (select id from public.campaigns where name = 'Campanie #626') as edu_campaign,
       (select id from public.campaigns where name = 'Campanie PR #626') as pr_campaign;
grant select on f626 to authenticated;

create temp table t626 (name text primary key, id bigint not null);
grant select on t626 to authenticated;

create function pg_temp.mk(p_name text, p_status text, p_mode text, p_audience text,
  p_executor uuid, p_round integer default 0, p_kind text default 'task')
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.tasks (title, description, deadline, group_id, status, audience, assignment_mode, kind,
                            created_by, created_at, started_at, submitted_at, review_round,
                            returned_to_progress_at, queue_opened_at, difficulty, rating, completed_at,
                            cancelled_at, cancel_reason)
  values ('T626 ' || p_name, 'Descriere ' || p_name,
          case when p_kind = 'task' then '2027-03-01 09:00:00+00'::timestamptz end,
          pg_temp.dept_group('edu'), p_status::public.task_status,
          case when p_kind = 'task' then p_audience end,
          case when p_kind = 'task' then p_mode end,
          p_kind, pg_temp.u(1), now() - interval '4 days',
          case when p_status in ('in_progress', 'in_review', 'completed') then now() - interval '2 days' end,
          case when p_status in ('in_review', 'completed') then now() - interval '1 day' end,
          p_round, case when p_round > 0 then now() - interval '1 day' end,
          case when p_mode = 'public' and p_kind = 'task' then now() - interval '3 days' end,
          case when p_status = 'completed' then 3 end,
          case when p_status = 'completed' then 4 end,
          case when p_status = 'completed' then now() end,
          case when p_status = 'cancelled' then now() end,
          case when p_status = 'cancelled' then 'Anulat #626' end)
  returning id into v_id;
  if p_executor is not null then
    insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
    values (v_id, p_executor, pg_temp.u(1), now() - interval '3 days');
  end if;
  insert into t626 values (p_name, v_id);
  return v_id;
end;
$$;

create function pg_temp.t(p_name text) returns bigint language sql stable as $$
  select id from t626 where name = p_name
$$;

create function pg_temp.cand(p_task text, p_member uuid, p_age interval) returns void language sql as $$
  insert into public.task_candidates (task_id, member_id, status, joined_at)
  select id, p_member, 'pending', now() - p_age from t626 where name = p_task
$$;

-- Section 2: one Task per (status, field), each direct/org with exec_in.
select pg_temp.mk(s.status_name || ':' || f.field, s.status, 'direct', 'org', pg_temp.u(2), s.round)
  from (values ('todo', 'todo', 0), ('progress', 'in_progress', 0), ('feedback', 'in_progress', 1))
         as s (status_name, status, round)
 cross join (values ('title'), ('description'), ('deadline'), ('campaign_id'), ('audience'), ('assignment_mode'))
         as f (field);

-- Section 3/4 targets.
select pg_temp.mk('x:review', 'in_review', 'direct', 'org', pg_temp.u(2));
select pg_temp.mk('x:done', 'completed', 'direct', 'org', null);
select pg_temp.mk('x:cancelled', 'cancelled', 'direct', 'org', null);
select pg_temp.mk('x:same', 'todo', 'direct', 'org', null);
select pg_temp.mk('x:input', 'todo', 'direct', 'org', null);
select pg_temp.mk('x:umbrella', 'todo', null, null, null, 0, 'umbrella');
select pg_temp.mk('x:auth', 'todo', 'direct', 'local', pg_temp.u(2));

-- Section 5: Public -> Direct, queue of three behind exec_in.
select pg_temp.mk('p2d', 'in_progress', 'public', 'org', pg_temp.u(2));
select pg_temp.cand('p2d', pg_temp.u(5), '3 hours');
select pg_temp.cand('p2d', pg_temp.u(4), '2 hours');
select pg_temp.cand('p2d', pg_temp.u(6), '1 hour');

-- Section 6: Direct -> Public.
select pg_temp.mk('d2p', 'todo', 'direct', 'local', null);

-- Section 7: R-E8.
select pg_temp.mk('r8:narrow', 'in_progress', 'public', 'org', pg_temp.u(3));
select pg_temp.cand('r8:narrow', pg_temp.u(5), '4 hours');
select pg_temp.cand('r8:narrow', pg_temp.u(4), '3 hours');
select pg_temp.cand('r8:narrow', pg_temp.u(6), '2 hours');
select pg_temp.cand('r8:narrow', pg_temp.u(7), '1 hour');
select pg_temp.mk('r8:keep', 'todo', 'public', 'org', pg_temp.u(2));
select pg_temp.cand('r8:keep', pg_temp.u(5), '2 hours');
select pg_temp.cand('r8:keep', pg_temp.u(4), '1 hour');
select pg_temp.mk('r8:direct', 'in_progress', 'direct', 'org', pg_temp.u(3));
select pg_temp.mk('r8:alone', 'in_progress', 'public', 'org', pg_temp.u(3));

-- Calls a command/preview with the Task's current values except the named overrides.
create function pg_temp.args(p_name text,
  p_title text default null, p_clear_description boolean default false,
  p_deadline timestamptz default null, p_campaign bigint default null,
  p_mode text default null, p_audience text default null, p_group bigint default null)
returns text language sql stable as $$
  select format('%s, %s, %L, %L, %L::timestamptz, %s, %L, %L',
    task.id, coalesce(p_group, task.group_id),
    coalesce(p_title, task.title),
    case when p_clear_description then null else task.description end,
    coalesce(p_deadline, task.deadline),
    coalesce(p_campaign::text, task.campaign_id::text, 'null'),
    coalesce(p_mode, task.assignment_mode),
    coalesce(p_audience, task.audience))
    from public.tasks as task where task.id = pg_temp.t(p_name)
$$;
grant execute on function pg_temp.args(text, text, boolean, timestamptz, bigint, text, text, bigint) to authenticated;

create function pg_temp.preview(p_args text) returns text[] language plpgsql as $$
declare
  v text[];
begin
  execute format('select coalesce(array_agg(c.consequence || '':'' || coalesce(c.member_id::text, '''') order by c.ord), ''{}'')
                    from public.preview_task_update(%s) with ordinality as c (consequence, member_id, ord)', p_args)
    into v;
  return v;
end;
$$;

create function pg_temp.preview_json(p_args text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''consequence'', c.consequence, ''member_id'', c.member_id) order by c.ord), ''[]'')
                    from public.preview_task_update(%s) with ordinality as c (consequence, member_id, ord)', p_args)
    into v;
  return v;
end;
$$;

create function pg_temp.activity_consequences(p_name text) returns jsonb language sql stable as $$
  select activity.details -> 'consequences' from public.task_activity as activity
   where activity.task_id = pg_temp.t(p_name) and activity.kind = 'task_updated'
$$;

create temp table previews (name text primary key, consequences jsonb);
grant select, insert on previews to authenticated;

-- ==================== 1. API shape and privileges ====================
select has_function('public', 'update_task',
  array['bigint', 'bigint', 'text', 'text', 'timestamp with time zone', 'bigint', 'text', 'text', 'boolean'],
  'public.update_task exists with the full-state signature plus p_accept_consequences');
select is(pg_get_function_arguments(
    'public.update_task(bigint,bigint,text,text,timestamptz,bigint,text,text,boolean)'::regprocedure),
  'p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_accept_consequences boolean DEFAULT false',
  'update_task takes no actor parameter and p_accept_consequences defaults to false');
select is(pg_get_function_result(
    'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text)'::regprocedure),
  'TABLE(consequence text, member_id uuid)',
  'preview_task_update takes the same value arguments and returns (consequence, member_id) rows');
select is((select provolatile::text from pg_proc
            where oid = 'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text)'::regprocedure),
  's', 'preview_task_update is stable');
select ok(not (select prosecdef from pg_proc
                where oid = 'public.update_task(bigint,bigint,text,text,timestamptz,bigint,text,text,boolean)'::regprocedure)
          and not (select prosecdef from pg_proc
                    where oid = 'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text)'::regprocedure),
  'both public functions are security invoker wrappers');
select ok(has_function_privilege('authenticated',
            'public.update_task(bigint,bigint,text,text,timestamptz,bigint,text,text,boolean)', 'execute')
          and has_function_privilege('authenticated',
            'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text)', 'execute')
          and not has_function_privilege('anon',
            'public.update_task(bigint,bigint,text,text,timestamptz,bigint,text,text,boolean)', 'execute')
          and not has_function_privilege('anon',
            'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text)', 'execute'),
  'authenticated may call both, anon neither');
select ok(not has_function_privilege('authenticated',
            'private.task_update_consequences(bigint,bigint,bigint,text,text)', 'execute')
          and not has_function_privilege('authenticated',
            'private.plan_task_update(public.tasks,bigint,text,text,timestamptz,bigint,text,text)', 'execute'),
  'the two shared helpers are callable only from inside the definer bodies');

-- ==================== 2. Every field, in todo / in_progress / Feedback pending ====================
create function pg_temp.edit_field(p_name text, p_field text) returns void language plpgsql as $$
begin
  execute format('select public.update_task(%s)', case p_field
    when 'title' then pg_temp.args(p_name, p_title => 'T626 ' || p_name || ' nou')
    when 'description' then pg_temp.args(p_name, p_clear_description => true)
    when 'deadline' then pg_temp.args(p_name, p_deadline => '2027-03-02 09:00:00+00')
    when 'campaign_id' then pg_temp.args(p_name, p_campaign => (select edu_campaign from f626))
    when 'audience' then pg_temp.args(p_name, p_audience => 'local')
    when 'assignment_mode' then pg_temp.args(p_name, p_mode => 'public')
  end);
end;
$$;

create function pg_temp.field_check(p_name text, p_field text) returns text language sql stable as $$
  select format('%s|%s|%s|%s',
    case p_field
      when 'title' then task.title = 'T626 ' || p_name || ' nou'
      when 'description' then task.description is null
      when 'deadline' then task.deadline = '2027-03-02 09:00:00+00'::timestamptz
      when 'campaign_id' then task.campaign_id = (select edu_campaign from f626)
      when 'audience' then task.audience = 'local'
      when 'assignment_mode' then task.assignment_mode = 'public' and task.queue_opened_at is not null
                                  and task.queue_closed_at is null
    end,
    (select activity.details -> 'changed' from public.task_activity as activity
      where activity.task_id = task.id and activity.kind = 'task_updated'),
    task.status::text || ':' || task.review_round,
    (select count(*) from public.notifications as notification
      where notification.task_id = task.id and notification.member_id = pg_temp.u(2)
        and notification.title = 'Task actualizat: ' || task.title
        and notification.body = 'Modificat: ' || p_field || '.'))
    from public.tasks as task where task.id = pg_temp.t(p_name)
$$;

select pg_temp.test_login_leadership(pg_temp.u(1));
select lives_ok($$
  select pg_temp.edit_field(s || ':' || f, f)
    from unnest(array['todo', 'progress', 'feedback']) as s
   cross join unnest(array['title', 'description', 'deadline', 'campaign_id', 'audience', 'assignment_mode']) as f
$$, 'the edu Group Manager edits each field alone on eighteen Tasks without any acceptance');
reset role;

select is(pg_temp.field_check(s.status_name || ':' || f.field, f.field),
          format('t|["%s"]|%s|1', f.field, s.expected),
          format('%s: editing %s alone stores it, logs one task_updated row naming only it, keeps the status and notifies the Executor',
                 s.status_name, f.field))
  from (values ('todo', 'todo:0'), ('progress', 'in_progress:0'), ('feedback', 'in_progress:1'))
         as s (status_name, expected)
 cross join (values ('title'), ('description'), ('deadline'), ('campaign_id'), ('audience'), ('assignment_mode'))
         as f (field)
 order by s.status_name, f.field;

select is((select format('%s|%s|%s|%s', activity.actor_id, activity.assignment_id is null,
                         activity.from_status is null and activity.to_status is null,
                         activity.details -> 'before' ->> 'title')
             from public.task_activity as activity
            where activity.task_id = pg_temp.t('feedback:title') and activity.kind = 'task_updated'),
  format('%s|t|t|T626 feedback:title', pg_temp.u(1)),
  'the task_updated row names the actor, is Task-level (no assignment_id, no status change) and keeps the old value in details.before');

-- ==================== 3. Refusals ====================
select pg_temp.test_login_leadership(pg_temp.u(1));
select throws_ok(format('select public.update_task(%s, true)', pg_temp.args('x:review', p_title => 'Nou #626')),
  'PT409', 'task_in_review', 'a Task in review is not editable, even with consequences accepted');
select throws_ok(format('select * from public.preview_task_update(%s)', pg_temp.args('x:review', p_title => 'Nou #626')),
  'PT409', 'task_in_review', 'the preview refuses a Task in review the same way');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:done', p_title => 'Nou #626')),
  'PT409', 'task_terminal', 'a completed Task is not editable');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:cancelled', p_title => 'Nou #626')),
  'PT409', 'task_terminal', 'a cancelled Task is not editable');
select throws_ok(format('select * from public.preview_task_update(%s)', pg_temp.args('x:done', p_title => 'Nou #626')),
  'PT409', 'task_terminal', 'the preview refuses a terminal Task the same way');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:same')),
  'PT409', 'nothing_to_update', 'a call that changes no field is refused, not a silent success');
select throws_ok(format('select * from public.preview_task_update(%s)', pg_temp.args('x:same')),
  'PT409', 'nothing_to_update', 'the preview refuses an unchanged state the same way');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:umbrella', p_mode => 'direct')),
  'PT409', 'task_is_umbrella', 'an Umbrella has no Assignment Mode to set');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:umbrella', p_campaign => (select edu_campaign from f626))),
  'PT400', 'umbrella_has_no_campaign', 'an Umbrella can never carry a Campaign');
select lives_ok(format('select public.update_task(%s)', pg_temp.args('x:umbrella', p_title => 'T626 umbrela noua')),
  'an Umbrella''s title is editable with null mode and Audience');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:input', p_title => '   ')),
  'PT400', 'title_required', 'a blank title is refused');
select throws_ok(format('select public.update_task(%s, %s, %L, %L, null, null, %L, %L)', pg_temp.t('x:input'), pg_temp.dept_group('edu'),
    'T626 x:input', 'd', 'direct', 'org'),
  'PT400', 'deadline_required', 'an ordinary Task needs a deadline');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:input', p_audience => 'world')),
  'PT400', 'invalid_audience', 'an Audience outside local/org is refused');
select throws_ok(format('select public.update_task(%s, %s, %L, %L, %L::timestamptz, null, null, %L)', pg_temp.t('x:input'), pg_temp.dept_group('edu'),
    'T626 x:input', 'd', '2027-03-01 09:00:00+00', 'org'),
  'PT400', 'invalid_assignment_mode', 'a null Assignment Mode on an ordinary Task is refused (full state, never a patch)');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:input', p_campaign => (select pr_campaign from f626))),
  'PT400', 'invalid_campaign', 'another Department''s Campaign is refused as in update_task_content');
reset role;
select is((select count(*) from public.task_activity as activity
            where activity.task_id in (pg_temp.t('x:review'), pg_temp.t('x:done'), pg_temp.t('x:cancelled'),
                                       pg_temp.t('x:same'), pg_temp.t('x:input'))),
  0::bigint, 'no refused edit wrote an activity row');
select is((select string_agg(task.title, ',' order by task.id) from public.tasks as task
            where task.id in (pg_temp.t('x:review'), pg_temp.t('x:done'), pg_temp.t('x:input'))),
  'T626 x:review,T626 x:done,T626 x:input', 'no refused edit changed a Task');

-- ==================== 4. Authority ====================
select pg_temp.test_login_leadership(pg_temp.u(2));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('x:auth', p_title => 'Furat #626')),
  '42501', 'task_manage_forbidden', 'the Task''s own Executor is not its manager');
select throws_ok(format('select * from public.preview_task_update(%s)', pg_temp.args('x:auth', p_title => 'Furat #626')),
  '42501', 'task_manage_forbidden', 'the preview uses the same authority gate');
reset role;
create temp table auth_args as select pg_temp.args('x:auth', p_title => 'Furat #626') as a;
grant select on auth_args to authenticated;
select pg_temp.test_login_leadership(pg_temp.u(8));
select throws_ok(format('select public.update_task(%s)', (select a from auth_args)),
  'PT404', 'task_not_found', 'a member who cannot read the Task learns nothing about it');
select throws_ok(format('select * from public.preview_task_update(%s)', (select a from auth_args)),
  'PT404', 'task_not_found', 'the preview is non-disclosing the same way');
reset role;
select is((select task.title from public.tasks as task where task.id = pg_temp.t('x:auth')), 'T626 x:auth',
  'no unauthorized call changed the Task');

-- ==================== 5. Public -> Direct ====================
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('p2d', p_mode => 'direct')),
  array['candidate_removed:' || pg_temp.u(5), 'candidate_removed:' || pg_temp.u(4), 'candidate_removed:' || pg_temp.u(6)],
  'the preview lists one candidate_removed per pending Candidate, in queue order');
insert into previews values ('p2d', pg_temp.preview_json(pg_temp.args('p2d', p_mode => 'direct')));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('p2d', p_mode => 'direct')),
  'PT409', 'task_update_needs_confirmation', 'Public -> Direct without acceptance is refused');
select throws_ok(format('select public.update_task(%s, false)', pg_temp.args('p2d', p_mode => 'direct')),
  'PT409', 'task_update_needs_confirmation', 'an explicit p_accept_consequences = false is refused the same way');
reset role;
select is((select format('%s|%s|%s|%s', task.assignment_mode,
                         (select count(*) from public.task_candidates as c where c.task_id = task.id and c.status = 'pending'),
                         (select count(*) from public.task_activity as a where a.task_id = task.id),
                         (select count(*) from public.notifications as n where n.task_id = task.id))
             from public.tasks as task where task.id = pg_temp.t('p2d')),
  'public|3|0|0', 'the refused edit wrote nothing: still public, three pending, no activity, no notification');
select pg_temp.test_login_leadership(pg_temp.u(1));
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('p2d', p_mode => 'direct')),
  'with the consequences accepted the Task goes Direct');
reset role;
select is((select format('%s|%s|%s', task.assignment_mode, task.queue_opened_at is null, task.queue_closed_at is null)
             from public.tasks as task where task.id = pg_temp.t('p2d')),
  'direct|t|t', 'the Task is direct with the queue timestamps cleared (tasks_queue_timestamp_state_ck)');
select is((select string_agg(c.status || ':' || (c.decided_by = pg_temp.u(1)) || ':' || (c.decided_at is not null), ',' order by c.joined_at)
             from public.task_candidates as c where c.task_id = pg_temp.t('p2d')),
  'closed:true:true,closed:true:true,closed:true:true', 'every pending Candidature ended closed, decided by the manager');
select is((select count(*) from public.notifications as n
            where n.task_id = pg_temp.t('p2d') and n.member_id in (pg_temp.u(4), pg_temp.u(5), pg_temp.u(6))
              and n.title = 'Coadă închisă: T626 p2d' and n.body = 'Nu mai poți fi selectat pentru acest task.'),
  3::bigint, 'each Candidate got the existing close-queue notification');
select is((select format('%s|%s', a.member_id, a.ended_at is null) from public.task_assignments as a
            where a.task_id = pg_temp.t('p2d')),
  format('%s|t', pg_temp.u(2)), 'the Executor keeps the Task');
select is((select count(*) from public.notifications as n
            where n.task_id = pg_temp.t('p2d') and n.member_id = pg_temp.u(2)
              and n.body = 'Modificat: assignment_mode.'), 1::bigint,
  'the Executor is told the Assignment Mode changed');
select is(pg_temp.activity_consequences('p2d'), (select consequences from previews where name = 'p2d'),
  'the command applied exactly the consequence set the preview showed');

-- ==================== 6. Direct -> Public ====================
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('d2p', p_mode => 'public')), '{}'::text[],
  'Direct -> Public has no consequence');
select lives_ok(format('select public.update_task(%s)', pg_temp.args('d2p', p_mode => 'public')),
  'so it applies without acceptance');
reset role;
select is((select format('%s|%s|%s', task.assignment_mode, task.queue_opened_at = now(), task.queue_closed_at is null)
             from public.tasks as task where task.id = pg_temp.t('d2p')),
  'public|t|t', 'Direct -> Public opens the queue now');
select is(pg_temp.activity_consequences('d2p'), '[]'::jsonb, 'and records an empty consequence set');

-- ==================== 7. R-E8: Audience narrowing ====================
-- (a) public, outsider Executor, mixed queue: Executor removed, outsiders removed, head member promoted.
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('r8:narrow', p_audience => 'local')),
  array['executor_removed:' || pg_temp.u(3), 'candidate_removed:' || pg_temp.u(5),
        'candidate_removed:' || pg_temp.u(6), 'candidate_promoted:' || pg_temp.u(4)],
  'local Audience on a public Task: the non-member Executor and non-member Candidates go, the head member Candidate is promoted');
insert into previews values ('r8:narrow', pg_temp.preview_json(pg_temp.args('r8:narrow', p_audience => 'local')));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('r8:narrow', p_audience => 'local')),
  'PT409', 'task_update_needs_confirmation', 'removing an Executor needs acceptance');
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('r8:narrow', p_audience => 'local')),
  'accepted, the narrowing applies');
reset role;
select is((select format('%s|%s', a.end_reason, a.ended_at is not null) from public.task_assignments as a
            where a.task_id = pg_temp.t('r8:narrow') and a.member_id = pg_temp.u(3)),
  'task_updated|t', 'the ineligible Executor''s Assignment ended with end_reason task_updated');
select is((select format('%s|%s|%s', task.status, task.started_at is null, task.audience)
             from public.tasks as task where task.id = pg_temp.t('r8:narrow')),
  'todo|t|local', 'the Task returned to todo with started_at cleared');
select is((select string_agg(right(c.member_id::text, 1) || ':' || c.status, ',' order by c.joined_at)
             from public.task_candidates as c where c.task_id = pg_temp.t('r8:narrow')),
  '5:closed,4:selected,6:closed,7:pending', 'non-members closed, the head member selected, the rest still queued');
select is((select format('%s|%s', a.member_id, (select c.assignment_id from public.task_candidates as c
                                                  where c.task_id = a.task_id and c.status = 'selected') = a.id)
             from public.task_assignments as a where a.task_id = pg_temp.t('r8:narrow') and a.ended_at is null),
  format('%s|t', pg_temp.u(4)), 'the promoted Candidate holds the one active Assignment');
select is((select string_agg(right(n.member_id::text, 1) || ':' || split_part(n.title, ':', 1), ',' order by n.member_id)
             from public.notifications as n where n.task_id = pg_temp.t('r8:narrow')),
  '3:Task actualizat,4:Task nou,5:Coadă închisă,6:Coadă închisă',
  'the removed Executor, the removed Candidates and the promoted Candidate are notified; the still-queued member is not');
select is((select n.body from public.notifications as n
            where n.task_id = pg_temp.t('r8:narrow') and n.member_id = pg_temp.u(3)),
  'Nu mai ești executorul acestui task: audiența lui s-a schimbat.', 'the removed Executor is told why');
select is((select format('%s|%s|%s', a.from_status, a.to_status,
                         (a.details ->> 'ended_assignment_id')::bigint =
                           (select x.id from public.task_assignments as x
                             where x.task_id = a.task_id and x.member_id = pg_temp.u(3)))
             from public.task_activity as a where a.task_id = pg_temp.t('r8:narrow') and a.kind = 'task_updated'),
  'in_progress|todo|t', 'the task_updated row records the return to todo and the ended Assignment');
select is((select string_agg(a.kind || ':' || coalesce(a.details ->> 'via', a.details ->> 'promoted', ''), ',' order by a.id)
             from public.task_activity as a where a.task_id = pg_temp.t('r8:narrow')),
  'task_updated:,executor_assigned:queue_promotion,candidate_selected:true',
  'the promotion is recorded as in give_up_task');
select is(pg_temp.activity_consequences('r8:narrow'), (select consequences from previews where name = 'r8:narrow'),
  'the command applied exactly the consequence set the preview showed');

-- (b) public, member Executor: only the non-member Candidate goes.
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('r8:keep', p_audience => 'local')),
  array['candidate_removed:' || pg_temp.u(5)], 'a member Executor stays; only the non-member Candidate is listed');
insert into previews values ('r8:keep', pg_temp.preview_json(pg_temp.args('r8:keep', p_audience => 'local')));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('r8:keep', p_audience => 'local')),
  'PT409', 'task_update_needs_confirmation', 'removing a Candidate needs acceptance');
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('r8:keep', p_audience => 'local')),
  'accepted, it applies');
reset role;
select is((select string_agg(right(c.member_id::text, 1) || ':' || c.status, ',' order by c.joined_at)
             from public.task_candidates as c where c.task_id = pg_temp.t('r8:keep')),
  '5:closed,4:pending', 'the non-member Candidature closed, the member stays queued');
select is((select format('%s|%s', a.member_id, a.ended_at is null) from public.task_assignments as a
            where a.task_id = pg_temp.t('r8:keep')),
  format('%s|t', pg_temp.u(2)), 'the member Executor keeps the Task');
select is((select string_agg(right(n.member_id::text, 1) || ':' || n.body, ',' order by n.member_id)
             from public.notifications as n where n.task_id = pg_temp.t('r8:keep')),
  '2:Modificat: audience.,5:Nu mai poți fi selectat pentru acest task.',
  'the Executor hears about the edit, the removed Candidate about the queue');
select is(pg_temp.activity_consequences('r8:keep'), (select consequences from previews where name = 'r8:keep'),
  'the command applied exactly the consequence set the preview showed');

-- (c) direct: Audience governs public queues only.
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('r8:direct', p_audience => 'local')), '{}'::text[],
  'on a direct Task a non-member Executor is not a consequence (ADR-0007: Audience governs public queues only)');
select lives_ok(format('select public.update_task(%s)', pg_temp.args('r8:direct', p_audience => 'local')),
  'so the narrowing applies without acceptance');
reset role;
select is((select format('%s|%s|%s', a.member_id, a.ended_at is null, task.status)
             from public.task_assignments as a join public.tasks as task on task.id = a.task_id
            where a.task_id = pg_temp.t('r8:direct')),
  format('%s|t|in_progress', pg_temp.u(3)), 'the direct Task keeps its Executor and status');
select is(pg_temp.activity_consequences('r8:direct'), '[]'::jsonb, 'and records an empty consequence set');

-- (d) public, outsider Executor, empty queue: removal without promotion.
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('r8:alone', p_audience => 'local')),
  array['executor_removed:' || pg_temp.u(3)], 'with an empty queue only the Executor''s removal is listed');
insert into previews values ('r8:alone', pg_temp.preview_json(pg_temp.args('r8:alone', p_audience => 'local')));
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('r8:alone', p_audience => 'local')),
  'accepted, it applies');
reset role;
select is((select format('%s|%s', task.status,
                         (select count(*) from public.task_assignments as a where a.task_id = task.id and a.ended_at is null))
             from public.tasks as task where task.id = pg_temp.t('r8:alone')),
  'todo|0', 'the Task is back in todo with no Executor');
select is(pg_temp.activity_consequences('r8:alone'), (select consequences from previews where name = 'r8:alone'),
  'the command applied exactly the consequence set the preview showed');

-- ==================== 8. The preview writes nothing ====================
select pg_temp.mk('pv', 'todo', 'public', 'org', pg_temp.u(3));
select pg_temp.cand('pv', pg_temp.u(5), '1 hour');
select pg_temp.test_login_leadership(pg_temp.u(1));
select is(pg_temp.preview(pg_temp.args('pv', p_mode => 'direct', p_audience => 'local', p_title => 'T626 pv nou')),
  array['candidate_removed:' || pg_temp.u(5)],
  'Public -> Direct with a narrowed Audience: the Candidate is listed once, the direct Executor stays');
reset role;
select is((select format('%s|%s|%s|%s|%s', task.title, task.assignment_mode,
                         (select count(*) from public.task_candidates as c where c.task_id = task.id and c.status = 'pending'),
                         (select count(*) from public.task_activity as a where a.task_id = task.id),
                         (select count(*) from public.notifications as n where n.task_id = task.id))
             from public.tasks as task where task.id = pg_temp.t('pv')),
  'T626 pv|public|1|0|0', 'the preview changed nothing, logged nothing and notified nobody');


-- ==================== 9. #627 Group moves and combined edits ====================
insert into auth.users (id, email) values
  (pg_temp.u(9), 'bc.627@test.local'), (pg_temp.u(10), 'eligible.627@test.local'),
  (pg_temp.u(11), 'eligible2.627@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  (pg_temp.u(9), 'BC 627', 'bc.627@test.local', 'bc', 'activ'),
  (pg_temp.u(10), 'Eligible 627', 'eligible.627@test.local', 'bce', 'activ'),
  (pg_temp.u(11), 'Eligible 627 B', 'eligible2.627@test.local', 'bce', 'activ');
update public.groups set min_level = 2, application_level = greatest(application_level, 2)
 where id = pg_temp.dept_group('pr');
select pg_temp.mk('627:add', 'in_progress', 'direct', 'org', pg_temp.u(10));
select pg_temp.mk('627:remove', 'in_progress', 'public', 'org', pg_temp.u(2));
select pg_temp.cand('627:remove', pg_temp.u(4), '2 hours');
select pg_temp.cand('627:remove', pg_temp.u(10), '1 hour');
select pg_temp.mk('627:campaign', 'todo', 'direct', 'org', null);
update public.tasks set campaign_id = (select edu_campaign from f626) where id = pg_temp.t('627:campaign');
select pg_temp.mk('627:combined', 'in_progress', 'public', 'org', pg_temp.u(11));
select pg_temp.cand('627:combined', pg_temp.u(1), '1 hour');

select pg_temp.test_login_leadership(pg_temp.u(1));
select throws_ok(format('select * from public.preview_task_update(%s)',
  pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))),
  '42501', 'group_manage_forbidden', 'source manager cannot preview an unauthorized target Group');
select throws_ok(format('select public.update_task(%s, true)',
  pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))),
  '42501', 'group_manage_forbidden', 'source manager cannot move into an unauthorized target Group');
reset role;
select pg_temp.test_login_leadership(pg_temp.u(9));
select is(pg_temp.preview(pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))),
  array['executor_added_to_group:' || pg_temp.u(10)], 'eligible Executor previews an appointment');
insert into previews values ('627:add', pg_temp.preview_json(pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))),
  'PT409', 'task_update_needs_confirmation', 'appointment refuses without acceptance');
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('627:add', p_group => pg_temp.dept_group('pr'))),
  'accepted appointment and Group move succeed');
reset role;
select is((select count(*)::integer from public.group_members where group_id = pg_temp.dept_group('pr') and member_id = pg_temp.u(10)),
  1, 'appointment core added the eligible Executor to target Group');
select is(pg_temp.activity_consequences('627:add'), (select consequences from previews where name = '627:add'),
  'appointment command records exactly the previewed consequence');
select is((select group_id from public.tasks where id = pg_temp.t('627:add')),
  pg_temp.dept_group('pr'), 'Task moved to target Group');

select pg_temp.test_login_leadership(pg_temp.u(9));
select is(pg_temp.preview(pg_temp.args('627:remove', p_group => pg_temp.dept_group('pr'))),
  array['executor_removed:' || pg_temp.u(2), 'candidate_removed:' || pg_temp.u(4)],
  'move previews below-Minimum-Level Executor and Candidate, but retains eligible outsider Candidate');
insert into previews values ('627:remove', pg_temp.preview_json(pg_temp.args('627:remove', p_group => pg_temp.dept_group('pr'))));
select throws_ok(format('select public.update_task(%s)', pg_temp.args('627:remove', p_group => pg_temp.dept_group('pr'))),
  'PT409', 'task_update_needs_confirmation', 'Executor and Candidate removal refuse without acceptance');
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('627:remove', p_group => pg_temp.dept_group('pr'))),
  'accepted removal and move succeed');
reset role;
select is((select end_reason from public.task_assignments where task_id = pg_temp.t('627:remove') and ended_at is not null),
  'group_changed', 'displaced Executor Assignment ends with group_changed');
select is((select format('%s|%s|%s', task.status,
  (select count(*) from public.task_assignments a where a.task_id = task.id and a.ended_at is null),
  (select count(*) from public.task_candidates c where c.task_id = task.id and c.status = 'pending'))
  from public.tasks task where task.id = pg_temp.t('627:remove')),
  'todo|0|1', 'Task returns to todo and eligible Candidate stays pending without promotion');
select is(pg_temp.activity_consequences('627:remove'), (select consequences from previews where name = '627:remove'),
  'removal command records exactly the previewed consequences');

select pg_temp.test_login_leadership(pg_temp.u(9));
select is(pg_temp.preview(pg_temp.args('627:campaign', p_group => pg_temp.dept_group('pr'))),
  array['campaign_cleared:'], 'incompatible existing Campaign previews clearing');
select throws_ok(format('select public.update_task(%s)', pg_temp.args('627:campaign', p_group => pg_temp.dept_group('pr'))),
  'PT409', 'task_update_needs_confirmation', 'Campaign clearing refuses without acceptance');
select lives_ok(format('select public.update_task(%s, true)', pg_temp.args('627:campaign', p_group => pg_temp.dept_group('pr'))),
  'accepted move clears incompatible Campaign');
reset role;
select is((select campaign_id from public.tasks where id = pg_temp.t('627:campaign')),
  null::bigint, 'Campaign was cleared on target Group');

select pg_temp.test_login_leadership(pg_temp.u(9));
select is(pg_temp.preview(pg_temp.args('627:combined', p_group => pg_temp.dept_group('pr'), p_audience => 'local')),
  array['executor_added_to_group:' || pg_temp.u(11), 'candidate_removed:' || pg_temp.u(1)],
  'simultaneous move and narrowing appoints eligible Executor but closes outsider Candidate');
select lives_ok(format('select public.update_task(%s, true)',
  pg_temp.args('627:combined', p_group => pg_temp.dept_group('pr'), p_audience => 'local')),
  'combined edit applies both consequences');
reset role;
select is((select format('%s|%s', task.status,
  (select count(*) from public.task_assignments a where a.task_id = task.id and a.ended_at is null))
  from public.tasks task where task.id = pg_temp.t('627:combined')),
  'in_progress|1', 'eligible Executor remains assigned on combined edit');


-- Structural restrictions apply to a real move, not an ordinary edit.
select pg_temp.mk('627:umbrella', 'todo', null, null, null, 0, 'umbrella');
with child as (
  insert into public.tasks (title, deadline, group_id, status, audience, assignment_mode,
    kind, parent_task_id, created_by)
  values ('T627 child', '2027-03-01 09:00:00+00', pg_temp.dept_group('edu'),
    'todo', 'org', 'direct', 'task', pg_temp.t('627:umbrella'), pg_temp.u(9))
  returning id)
insert into t626 select '627:child', id from child;
select pg_temp.test_login_leadership(pg_temp.u(9));
select throws_ok(format('select * from public.preview_task_update(%s)',
  pg_temp.args('627:umbrella', p_group => pg_temp.dept_group('pr'))),
  'PT409', 'umbrella_has_subtasks', 'Umbrella with Subtasks cannot move');
select throws_ok(format('select public.update_task(%s, true)',
  pg_temp.args('627:child', p_group => pg_temp.dept_group('pr'))),
  'PT409', 'subtask_origin_immutable', 'Subtask cannot leave its Umbrella Group');
select lives_ok(format('select public.update_task(%s)',
  pg_temp.args('627:child', p_title => 'T627 child edited')),
  'same-Group Subtask edit stays valid');
select lives_ok(format('select public.update_task(%s)',
  pg_temp.args('627:umbrella', p_title => 'T627 umbrella edited')),
  'same-Group Umbrella edit stays valid with children');
reset role;
update public.groups set status = 'archived' where id = pg_temp.dept_group('edu');
select pg_temp.test_login_leadership(pg_temp.u(9));
select lives_ok(format('select public.update_task(%s)',
  pg_temp.args('627:child', p_title => 'T627 child archived edit')),
  'BC may still edit an unchanged Group on an archived Group');
reset role;

select * from finish();
rollback;
