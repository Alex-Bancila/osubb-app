-- #985: Task Difficulty has ten levels, each with its own base points, and
-- Task Points stay base points x public.rating_mult(Rating).
--
-- What this suite pins:
--   1. public.task_difficulty_levels holds exactly the ten levels of the
--      rating guide, members read it, claimless callers and anon do not, and
--      nobody but a migration writes it.
--   2. The stored range is 1..10 on tasks and task_evaluations.
--   3. private.evaluate_task refuses a Difficulty with no level (0, 11,
--      null) as PT400 invalid_difficulty, and awards every level x every
--      Rating exactly as the guide says -- the expected numbers are written
--      out here, never read from the table, so a wrong base point fails.
--      Levels 1..5 are the old Difficulty x multiplier, unchanged.
--   4. All four evaluating commands accept 10 and refuse 11, and the award
--      reaches the Executor's ledger, public.my_points and the Clasament.
--   5. Awards of 20 and more read "de puncte" in both notifications.
--   6. The retired public.difficulty_guide is gone (#989): this table is the
--      only Difficulty reference.
--
-- Fixture prefix 98500000-0000-0000-0000-0000000000NN; native Groups written
-- as the owner in this rolled-back transaction (conventions §10).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- ==================== Fixtures ====================
create function pg_temp.u985(n integer) returns uuid language sql immutable as $$
  select ('98500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u985(integer) to authenticated, anon;

-- 1 BC (the evaluator)   2 the matrix Executor   3 the commands' Executor
-- 4 a member who logs in without organization claims
insert into auth.users (id, email)
select pg_temp.u985(n), 'm985.' || n || '@test.local' from generate_series(1, 4) n;

insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u985(n), 'Membru 985 ' || n, 'm985.' || n || '@test.local',
       (case n when 1 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 4) n;

insert into public.groups (name, category, min_level) values ('Dept #985', 'department', 0);
create function pg_temp.g985() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = 'Dept #985'
$$;
grant execute on function pg_temp.g985() to authenticated, anon;

insert into public.group_members (group_id, member_id, group_role)
select pg_temp.g985(), pg_temp.u985(n), 'member' from generate_series(2, 4) n;

-- A direct Task with an active Executor, in the state a command needs.
create function pg_temp.task985(p_title text, p_executor uuid, p_status text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.tasks (title, group_id, audience, assignment_mode, status, deadline, created_by, created_at)
  values (p_title, pg_temp.g985(), 'local', 'direct', 'todo', now() - interval '1 day',
          pg_temp.u985(1), now() - interval '3 days')
  returning id into v_id;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (v_id, p_executor, pg_temp.u985(1), now() - interval '3 days');
  if p_status = 'in_review' then
    update public.tasks set status = 'in_progress', started_at = now() - interval '2 days' where id = v_id;
    update public.tasks set status = 'in_review', submitted_at = now() - interval '1 day' where id = v_id;
  elsif p_status = 'in_progress' then
    update public.tasks set status = 'in_progress', started_at = now() - interval '2 days' where id = v_id;
  end if;
  return v_id;
end;
$$;

create function pg_temp.t985(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
grant execute on function pg_temp.t985(text) to authenticated, anon;

-- The guide, written out: level -> base points, Rating -> multiplier.
create temp table guide985 (level int, base int, rating int, mult int);
insert into guide985
select level, base, rating, mult
  from (values (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 15), (10, 20)) as l (level, base)
 cross join (values (1, -1), (2, 0), (3, 1), (4, 2), (5, 3)) as r (rating, mult);

-- ==================== 1. The reference table ====================
select results_eq(
  $$ select level::int, kind, label, coalesce(glyph, '-'), base_points::int
       from public.task_difficulty_levels order by level $$,
  $$ values (1, 'star', '1 stea', '⭐', 1), (2, 'star', '2 stele', '⭐⭐', 2),
            (3, 'star', '3 stele', '⭐⭐⭐', 3), (4, 'star', '4 stele', '⭐⭐⭐⭐', 4),
            (5, 'star', '5 stele', '⭐⭐⭐⭐⭐', 5),
            (6, 'medal', 'Bronz', '🥉', 6), (7, 'medal', 'Argint', '🥈', 7), (8, 'medal', 'Aur', '🥇', 8),
            (9, 'text', 'Responsabil', '-', 15), (10, 'text', 'Coordonator', '-', 20) $$,
  'the ten levels of the rating guide: five stars, Bronz/Argint/Aur, Responsabil and Coordonator, with their base points');

select ok((select relrowsecurity from pg_class where oid = 'public.task_difficulty_levels'::regclass),
  'task_difficulty_levels has row level security enabled');

select throws_ok($$ insert into public.task_difficulty_levels (level, kind, label, glyph, base_points)
                    values (11, 'text', 'Peste ghid', null, 30) $$,
  '23514', 'new row for relation "task_difficulty_levels" violates check constraint "task_difficulty_levels_level_ck"',
  'a level above 10 cannot be stored');
-- Level 3 exists, but a CHECK is judged before the primary key is.
select throws_ok($$ insert into public.task_difficulty_levels (level, kind, label, glyph, base_points)
                    values (3, 'medal', 'Fara', null, 1) $$,
  '23514', 'new row for relation "task_difficulty_levels" violates check constraint "task_difficulty_levels_glyph_shape_ck"',
  'a medal without a glyph is refused (only a text level is shown by its label alone)');

select ok(not has_table_privilege('anon', 'public.task_difficulty_levels', 'select'),
  'anon cannot read the levels');
select ok(has_table_privilege('authenticated', 'public.task_difficulty_levels', 'select')
      and not has_table_privilege('authenticated', 'public.task_difficulty_levels', 'insert')
      and not has_table_privilege('authenticated', 'public.task_difficulty_levels', 'update')
      and not has_table_privilege('authenticated', 'public.task_difficulty_levels', 'delete'),
  'authenticated reads the levels and writes none: they change only by migration');
select ok(has_table_privilege('service_role', 'public.task_difficulty_levels', 'select')
      and not has_table_privilege('service_role', 'public.task_difficulty_levels', 'insert')
      and not has_table_privilege('service_role', 'public.task_difficulty_levels', 'update')
      and not has_table_privilege('service_role', 'public.task_difficulty_levels', 'delete'),
  'service_role reads the levels and writes none either');

select pg_temp.test_login_leadership(pg_temp.u985(3));
select is((select count(*) from public.task_difficulty_levels), 10::bigint,
  'an ordinary member reads all ten levels (the guide and the pickers)');
reset role;

select pg_temp.test_login(pg_temp.u985(4), '{"provider":"email"}'::jsonb);
select is((select count(*) from public.task_difficulty_levels), 0::bigint,
  'a session without organization claims reads none');
reset role;

select hasnt_table('public', 'difficulty_guide',
  'the retired difficulty_guide is dropped: task_difficulty_levels is the only Difficulty reference (#989)');

-- ==================== 2. The stored range ====================
select is((select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.tasks'::regclass and conname = 'tasks_difficulty_ck'),
  'CHECK (((difficulty >= 1) AND (difficulty <= 10)))',
  'tasks_difficulty_ck admits 1..10');
select is((select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.task_evaluations'::regclass and conname = 'task_evaluations_difficulty_ck'),
  'CHECK (((difficulty >= 1) AND (difficulty <= 10)))',
  'task_evaluations_difficulty_ck admits 1..10');

-- ==================== 3. evaluate_task ====================
select throws_ok($$ select private.evaluate_task(-1, 'completed', 0, 3, 'n', null) $$,
  'PT400', 'invalid_difficulty', 'evaluate_task refuses Difficulty 0');
select throws_ok($$ select private.evaluate_task(-1, 'completed', 11, 3, 'n', null) $$,
  'PT400', 'invalid_difficulty', 'evaluate_task refuses Difficulty 11');
select throws_ok($$ select private.evaluate_task(-1, 'completed', null, 3, 'n', null) $$,
  'PT400', 'invalid_difficulty', 'evaluate_task refuses a null Difficulty');

-- Every level x every Rating, straight through the core.
select pg_temp.task985('Grila ' || level || '/' || rating || ' #985', pg_temp.u985(2), 'todo')
  from guide985 order by level, rating;
select private.evaluate_task(pg_temp.t985('Grila ' || level || '/' || rating || ' #985'),
                             'completed', level, rating, 'Evaluare grila', pg_temp.u985(1))
  from guide985 order by level, rating;

select results_eq(
  $$ select evaluation.difficulty, evaluation.rating, evaluation.points
       from public.task_evaluations as evaluation
       join public.tasks as task on task.id = evaluation.task_id
      where task.title like 'Grila %#985'
      order by evaluation.difficulty, evaluation.rating $$,
  $$ select level, rating, base * mult from guide985 order by level, rating $$,
  'every level x every Rating awards base points x the multiplier: 1..5 as before, 6/7/8, 15 and 20 for the new levels');

select is((select string_agg(evaluation.points::text, ',' order by evaluation.rating)
             from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id
            where task.title like 'Grila 10/%#985'),
  '-20,0,20,40,60',
  'a Coordonator Task earns -20, 0, 20, 40, 60 for Note 1..5');
select is((select evaluation.points from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id
            where task.title = 'Grila 6/3 #985'),
  6, 'a Bronz Task rated 3 earns 6');

select is((select count(*) from public.points_ledger as ledger
             join public.task_evaluations as evaluation on evaluation.id = ledger.evaluation_id
             join public.tasks as task on task.id = evaluation.task_id
            where task.title like 'Grila %#985'
              and ledger.reason = 'task' and ledger.delta = evaluation.points
              and ledger.member_id = pg_temp.u985(2)),
  50::bigint, 'each of the fifty awards is one ledger row crediting the Executor with exactly that Evaluation''s points');

select is((select details ->> 'points' from public.task_activity as activity
            where activity.task_id = pg_temp.t985('Grila 9/5 #985') and activity.kind = 'evaluated'),
  '45', 'the evaluated activity row carries the level''s award (Responsabil x 3 = 45)');

select is((select body from public.notifications
            where task_id = pg_temp.t985('Grila 10/5 #985') and member_id = pg_temp.u985(2)),
  '60 de puncte (dificultate 10, calificativ 5).',
  'an award of 20 or more reads "de puncte"');
select is((select body from public.notifications
            where task_id = pg_temp.t985('Grila 10/1 #985') and member_id = pg_temp.u985(2)),
  '-20 de puncte (dificultate 10, calificativ 1).',
  'and so does a loss of 20');
select is((select body from public.notifications
            where task_id = pg_temp.t985('Grila 8/4 #985') and member_id = pg_temp.u985(2)),
  '16 puncte (dificultate 8, calificativ 4).',
  'below 20 the bare plural stays');

-- ==================== 4. The four commands ====================
select pg_temp.task985('Revizuire Coordonator #985', pg_temp.u985(3), 'in_review');
select pg_temp.task985('Revizuire peste ghid #985', pg_temp.u985(3), 'in_review');
select pg_temp.task985('Nerealizat Coordonator #985', pg_temp.u985(3), 'in_progress');
select pg_temp.task985('Nerealizat peste ghid #985', pg_temp.u985(3), 'in_progress');
insert into public.completed_work_requests (requester_id, group_id, description) values
  (pg_temp.u985(3), pg_temp.g985(), 'Q1 cerere Coordonator #985'),
  (pg_temp.u985(3), pg_temp.g985(), 'Q2 cerere peste ghid #985');
create function pg_temp.q985(p_prefix text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.completed_work_requests where description like p_prefix || ' %'
$$;
grant execute on function pg_temp.q985(text) to authenticated, anon;

select pg_temp.test_login_leadership(pg_temp.u985(1));
select throws_ok(format($q$ select public.complete_task_review(%s, 11, 5, 'Nota') $q$,
                        pg_temp.t985('Revizuire peste ghid #985')),
  'PT400', 'invalid_difficulty', 'complete_task_review refuses Difficulty 11');
select lives_ok(format($q$ select public.complete_task_review(%s, 10, 5, 'Coordonare impecabila') $q$,
                       pg_temp.t985('Revizuire Coordonator #985')),
  'complete_task_review accepts Difficulty 10');
select throws_ok(format($q$ select public.mark_task_unfulfilled(%s, 11, 1, 'Nota') $q$,
                        pg_temp.t985('Nerealizat peste ghid #985')),
  'PT400', 'invalid_difficulty', 'mark_task_unfulfilled refuses Difficulty 11');
select lives_ok(format($q$ select public.mark_task_unfulfilled(%s, 10, 1, 'Nu a fost livrat') $q$,
                       pg_temp.t985('Nerealizat Coordonator #985')),
  'mark_task_unfulfilled accepts Difficulty 10');
select throws_ok(format($q$ select public.approve_completed_work_request(%s, 11, 3, 'Nota') $q$,
                        pg_temp.q985('Q2')),
  'PT400', 'invalid_difficulty', 'approve_completed_work_request refuses Difficulty 11');
select lives_ok(format($q$ select public.approve_completed_work_request(%s, 10, 4, 'Munca reala') $q$,
                       pg_temp.q985('Q1')),
  'approve_completed_work_request accepts Difficulty 10');
select throws_ok(format($q$ select public.create_completed_task(%L, %s, 'Peste ghid #985', null, null, null, null, 11, 5, 'n') $q$,
                        pg_temp.u985(3), pg_temp.g985()),
  'PT400', 'invalid_difficulty', 'create_completed_task refuses Difficulty 11');
select lives_ok(format($q$ select public.create_completed_task(%L, %s, 'Responsabil finalizat #985', null, null, null, null, 9, 5, 'Bine') $q$,
                       pg_temp.u985(3), pg_temp.g985()),
  'create_completed_task accepts Difficulty 9');
reset role;

select results_eq(
  $$ select task.title, task.difficulty, task.rating, evaluation.points
       from public.task_evaluations as evaluation
       join public.tasks as task on task.id = evaluation.task_id
       join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
      where assignment.member_id = '98500000-0000-0000-0000-000000000003'
      order by task.title $$,
  $$ values ('Nerealizat Coordonator #985', 10, 1, -20),
            ('Q1 cerere Coordonator #985', 10, 4, 40),
            ('Responsabil finalizat #985', 9, 5, 45),
            ('Revizuire Coordonator #985', 10, 5, 60) $$,
  'the four commands award base points x the multiplier: 60, -20, 40 and 45');

select is((select body from public.notifications
            where member_id = pg_temp.u985(3) and title like 'Cerere aprobată:%'),
  '40 de puncte (dificultate 10, calificativ 4).',
  'the approval notification reads the points evaluate_task wrote, with "de puncte"');

select pg_temp.test_login_leadership(pg_temp.u985(3));
select is((select points from public.my_points), 125,
  'public.my_points follows: 60 - 20 + 40 + 45 = 125');
reset role;

select pg_temp.test_login_leadership(pg_temp.u985(1));
select is((select points from public.leadership_leaderboard() where member_id = pg_temp.u985(3)), 125,
  'the Clasament follows too');
select is((select points from public.leadership_leaderboard() where member_id = pg_temp.u985(2)),
  355,
  'and carries the matrix Executor''s fifty awards (71 base points x the five multipliers = 355)');
reset role;

select * from finish();
rollback;
