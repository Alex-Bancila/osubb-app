-- create_event.test.sql — issue #245: one privileged, validated event command.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(38);

create function pg_temp.login(
  uid uuid,
  r text,
  lvl int,
  depts jsonb,
  with_org_claims boolean default true
) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid,
    'role', 'authenticated',
    'app_metadata', case when with_org_claims then jsonb_build_object(
      'member_role', r,
      'member_level', lvl,
      'dept_ids', depts,
      'team_ids', '[]'::jsonb
    ) else jsonb_build_object('provider', 'email') end
  )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

truncate public.events, public.event_attendance cascade;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000245', 'radu.recrut.create-event@test.local'),
  ('b2000000-0000-0000-0000-000000000245', 'vali.voluntar.create-event@test.local'),
  ('c3000000-0000-0000-0000-000000000245', 'raluca.responsabil.create-event@test.local'),
  ('d4000000-0000-0000-0000-000000000245', 'bianca.bc.create-event@test.local'),
  ('e5000000-0000-0000-0000-000000000245', 'dorin.inactiv.create-event@test.local'),
  ('f6000000-0000-0000-0000-000000000245', 'no.profile.create-event@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a1000000-0000-0000-0000-000000000245', 'Radu Recrut', 'radu.recrut.create-event@test.local', 'recrut', 'activ'),
  ('b2000000-0000-0000-0000-000000000245', 'Vali Voluntar', 'vali.voluntar.create-event@test.local', 'voluntar', 'activ'),
  ('c3000000-0000-0000-0000-000000000245', 'Raluca Responsabil', 'raluca.responsabil.create-event@test.local', 'responsabil', 'activ'),
  ('d4000000-0000-0000-0000-000000000245', 'Bianca BC', 'bianca.bc.create-event@test.local', 'bc', 'activ'),
  ('e5000000-0000-0000-0000-000000000245', 'Dorin Inactiv', 'dorin.inactiv.create-event@test.local', 'responsabil', 'inactiv');

insert into public.member_departments (member_id, dept_id) values
  ('a1000000-0000-0000-0000-000000000245', 'edu'),
  ('b2000000-0000-0000-0000-000000000245', 'edu'),
  ('c3000000-0000-0000-0000-000000000245', 'edu'),
  ('d4000000-0000-0000-0000-000000000245', 'pr'),
  ('e5000000-0000-0000-0000-000000000245', 'edu');

insert into public.teams (id, name, dept_id) values
  ('calendar-create-team-245', 'Echipa calendar #245', 'pr'),
  ('calendar-team-no-dept-245', 'Echipa fără departament #245', null);

-- Interface and least-privilege boundary. There is deliberately no creator
-- argument: the command must always derive that value from auth.uid().
select has_function('public', 'create_event', 'create_event() exists');
select ok(coalesce((
  select p.pronargs = 10
     and p.prorettype = 'public.events'::regtype::oid
     and p.proargtypes[1] = 'text'::regtype::oid
     and p.proargtypes[2] = 'text'::regtype::oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), false), 'the RPC exposes only the ten supported event inputs and returns the row');
select ok(not coalesce((
  select 'p_created_by' = any(p.proargnames)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), true), 'the caller cannot supply a creator id');
select ok(coalesce((
  select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), false), 'the command is SECURITY DEFINER because direct inserts are revoked');
select ok(coalesce((
  select 'search_path=""' = any(p.proconfig)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), false), 'the command has an empty search_path');
select ok(coalesce((
  select has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), false), 'authenticated may execute the command');
select ok(not coalesce((
  select has_function_privilege('anon', p.oid, 'execute')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_event'
), true), 'anon cannot execute the command');
select ok(not has_table_privilege('authenticated', 'public.events', 'insert'),
  'authenticated cannot bypass the command with a direct insert');
select ok(not has_table_privilege('authenticated', 'public.events', 'update'),
  'authenticated cannot bypass the future update command');
select ok(not has_table_privilege('authenticated', 'public.events', 'delete'),
  'authenticated cannot directly delete events');

-- A Responsabil creates an organisation event. The stored creator is the
-- authenticated caller, not an input that could be forged.
select pg_temp.login(
  'c3000000-0000-0000-0000-000000000245', 'responsabil', 4, '["edu"]');
select lives_ok($$
  select public.create_event(
    p_title := 'Adunare generală',
    p_type := 'sedinta',
    p_scope := 'org',
    p_starts_at := '2026-09-15 15:00:00+00',
    p_ends_at := '2026-09-15 17:00:00+00',
    p_location := 'Sala Auditorium',
    p_capacity := 120,
    p_description := 'Întâlnire pentru toată organizația'
  )
$$, 'a Responsabil creates a valid organisation event');
reset role;
select is(
  (select created_by from public.events where title = 'Adunare generală'),
  'c3000000-0000-0000-0000-000000000245'::uuid,
  'the command stamps created_by from auth.uid()');
select is(
  (select scope::text || ':' || coalesce(dept_id, '-') || ':' || coalesce(team_id, '-')
     from public.events where title = 'Adunare generală'),
  'org:-:-', 'the organisation event stores no department or team');

-- A BC member creates department and team events. Team department is looked
-- up by the command and never trusted from client input.
select pg_temp.login(
  'd4000000-0000-0000-0000-000000000245', 'bc', 6, '["pr"]');
select lives_ok($$
  select public.create_event(
    p_title := 'Ședință Educațional', p_type := 'sedinta',
    p_scope := 'dept', p_starts_at := now() + interval '3 days',
    p_dept_id := 'edu'
  )
$$, 'BC creates a department event');
select lives_ok($$
  select public.create_event(
    p_title := 'Lucru pe campanie', p_type := 'activitate',
    p_scope := 'team', p_starts_at := now() + interval '4 days',
    p_team_id := 'calendar-create-team-245'
  )
$$, 'BC creates a team event without supplying its department');
reset role;
select is(
  (select dept_id from public.events where title = 'Lucru pe campanie'),
  'pr', 'the team event receives the team''s real department');

-- Current database membership and org claims are both required. This denies
-- stale manager tokens after deactivation and real auth users without a
-- provisioned organization identity.
select pg_temp.login(
  'a1000000-0000-0000-0000-000000000245', 'recrut', 0, '["edu"]');
select throws_ok($$
  select public.create_event('Recrut', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', 'calendar_manage_forbidden', 'a Recrut cannot create events');
reset role;

select pg_temp.login(
  'b2000000-0000-0000-0000-000000000245', 'voluntar', 1, '["edu"]');
select throws_ok($$
  select public.create_event('Voluntar', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', 'calendar_manage_forbidden', 'a Voluntar cannot create events');
reset role;

select pg_temp.login(
  'c3000000-0000-0000-0000-000000000245', 'responsabil', 4, '["edu"]', false);
select throws_ok($$
  select public.create_event('Fără claims', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', 'calendar_manage_forbidden', 'a profile without org claims is denied');
reset role;

select pg_temp.login(
  'e5000000-0000-0000-0000-000000000245', 'responsabil', 4, '["edu"]');
select throws_ok($$
  select public.create_event('Dezactivat', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', 'calendar_manage_forbidden', 'an inactive manager is denied despite stale claims');
reset role;

select pg_temp.login(
  'f6000000-0000-0000-0000-000000000245', 'responsabil', 4, '[]');
select throws_ok($$
  select public.create_event('Fără profil', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', 'calendar_manage_forbidden', 'an auth user without a profile is denied');
reset role;

-- Stable errors cover every scope and value that would otherwise leak a raw
-- constraint or foreign-key error through PostgREST.
select pg_temp.login(
  'c3000000-0000-0000-0000-000000000245', 'responsabil', 4, '["edu"]');
select throws_ok($$
  select public.create_event('Proiect', 'sedinta', 'project', now() + interval '1 day')
$$, 'PT400', 'unsupported_event_scope', 'project scope is rejected in v1');
select throws_ok($$
  select public.create_event(
    p_title := 'Org cu departament', p_type := 'sedinta', p_scope := 'org',
    p_starts_at := now() + interval '1 day', p_dept_id := 'edu')
$$, 'PT400', 'invalid_event_scope_fields', 'org scope rejects department input');
select throws_ok($$
  select public.create_event('Departament lipsă', 'sedinta', 'dept', now() + interval '1 day')
$$, 'PT400', 'invalid_event_scope_fields', 'department scope requires a department');
select throws_ok($$
  select public.create_event(
    p_title := 'Departament necunoscut', p_type := 'sedinta', p_scope := 'dept',
    p_starts_at := now() + interval '1 day', p_dept_id := 'missing-dept')
$$, 'PT404', 'department_not_found', 'an unknown department has a stable error');
select throws_ok($$
  select public.create_event('Echipă lipsă', 'sedinta', 'team', now() + interval '1 day')
$$, 'PT400', 'invalid_event_scope_fields', 'team scope requires a team');
select throws_ok($$
  select public.create_event(
    p_title := 'Echipă cu departament trimis', p_type := 'sedinta', p_scope := 'team',
    p_starts_at := now() + interval '1 day', p_dept_id := 'pr',
    p_team_id := 'calendar-create-team-245')
$$, 'PT400', 'invalid_event_scope_fields', 'team scope rejects a client-supplied department');
select throws_ok($$
  select public.create_event(
    p_title := 'Echipă necunoscută', p_type := 'sedinta', p_scope := 'team',
    p_starts_at := now() + interval '1 day', p_team_id := 'missing-team')
$$, 'PT404', 'team_not_found', 'an unknown team has a stable error');
select throws_ok($$
  select public.create_event(
    p_title := 'Echipă fără departament', p_type := 'sedinta', p_scope := 'team',
    p_starts_at := now() + interval '1 day', p_team_id := 'calendar-team-no-dept-245')
$$, 'PT400', 'team_department_required',
  'a team without a department has a stable validation error');
select throws_ok($$
  select public.create_event('   ', 'sedinta', 'org', now() + interval '1 day')
$$, 'PT400', 'invalid_event_title', 'blank titles have a stable validation error');
select throws_ok($sql$
  select public.create_event(E'\t\n', 'sedinta', 'org', now() + interval '1 day')
$sql$, 'PT400', 'invalid_event_title', 'every all-whitespace title has the same error');
select throws_ok($$
  select public.create_event('Tip greșit', 'necunoscut', 'org', now() + interval '1 day')
$$, 'PT400', 'invalid_event_type', 'an unsupported event type has a stable error');
select throws_ok($$
  select public.create_event('Scope greșit', 'sedinta', 'necunoscut', now() + interval '1 day')
$$, 'PT400', 'unsupported_event_scope', 'an unsupported scope has a stable error');
select throws_ok($$
  select public.create_event(
    p_title := 'Interval greșit', p_type := 'sedinta', p_scope := 'org',
    p_starts_at := '2026-09-15 15:00:00+00', p_ends_at := '2026-09-15 15:00:00+00')
$$, 'PT400', 'invalid_event_interval', 'a non-increasing interval is rejected');
select throws_ok($$
  select public.create_event(
    p_title := 'Capacitate greșită', p_type := 'sedinta', p_scope := 'org',
    p_starts_at := now() + interval '1 day', p_capacity := 0)
$$, 'PT400', 'invalid_event_capacity', 'non-positive capacity is rejected');

select throws_ok($$
  insert into public.events (title, type, scope, starts_at)
  values ('Insert direct', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', null, 'even a manager cannot insert directly');
reset role;

select is((select count(*) from public.events), 3::bigint,
  'only the three valid command calls created rows');

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$
  select public.create_event('Anon', 'sedinta', 'org', now() + interval '1 day')
$$, '42501', null, 'anon cannot execute the command');
reset role;

select * from finish();
rollback;
