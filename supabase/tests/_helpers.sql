-- Shared pgTAP helpers. Suites set `osubb_test_suite` before sourcing this
-- file. Supabase also discovers every .sql file, so direct execution runs the
-- helper contract tests below in a transaction that is rolled back.
\if :{?osubb_test_suite}
\else
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
\endif

create or replace function pg_temp.test_login(
  p_uid uuid,
  p_app_metadata jsonb
)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_uid,
      'role', 'authenticated',
      'app_metadata', p_app_metadata
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.test_login_leadership(p_uid uuid)
returns void
language plpgsql
as $$
declare
  v_app_metadata jsonb;
begin
  select jsonb_build_object(
           'member_role', profile.role,
           'member_level', role.level,
           'dept_ids', coalesce((
             select jsonb_agg(membership.dept_id order by membership.dept_id)
               from public.member_departments as membership
              where membership.member_id = profile.id
           ), '[]'::jsonb),
           'team_ids', coalesce((
             select jsonb_agg(membership.team_id order by membership.team_id)
               from public.team_members as membership
              where membership.member_id = profile.id
           ), '[]'::jsonb)
         )
    into strict v_app_metadata
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = p_uid;

  perform pg_temp.test_login(p_uid, v_app_metadata);
end;
$$;

create or replace function pg_temp.test_clear_jwt()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

create or replace function pg_temp.test_race(
  p_sql_a text,
  p_sql_b text
)
returns table(result_a text, result_b text, b_waited boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection_a text := format('test_race_a_%s', pg_backend_pid());
  v_connection_b text := format('test_race_b_%s', pg_backend_pid());
  v_database text := current_database();
  v_jwt text := current_setting('request.jwt.claims', true);
  v_busy integer;
  v_saw_state boolean := false;
begin
  if coalesce(v_jwt, '') = '' then
    raise exception 'test_race requires test_login first';
  end if;

  perform extensions.dblink_connect(v_connection_a, format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=%s',
    v_database, v_connection_a));
  perform extensions.dblink_connect(v_connection_b, format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=%s',
    v_database, v_connection_b));

  perform extensions.dblink_exec(v_connection_a, $$
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '2s';
  $$);
  perform extensions.dblink_exec(v_connection_b, $$
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '2s';
  $$);

  perform setting from extensions.dblink(
    v_connection_a,
    format('select set_config(''request.jwt.claims'', %L, true)', v_jwt)
  ) as remote_claims(setting text);
  perform setting from extensions.dblink(
    v_connection_b,
    format('select set_config(''request.jwt.claims'', %L, true)', v_jwt)
  ) as remote_claims(setting text);
  perform extensions.dblink_exec(v_connection_a, 'set local role authenticated');
  perform extensions.dblink_exec(v_connection_b, 'set local role authenticated');

  select remote_result
    into strict result_a
    from extensions.dblink(v_connection_a, p_sql_a)
      as remote(remote_result text);

  if extensions.dblink_send_query(v_connection_b, p_sql_b) <> 1 then
    raise exception 'test_race could not start query B';
  end if;

  for attempt in 1..100 loop
    perform pg_catalog.pg_stat_clear_snapshot();
    v_busy := extensions.dblink_is_busy(v_connection_b);

    if exists (
      select 1
        from pg_catalog.pg_stat_activity
       where application_name = v_connection_b
         and wait_event_type = 'Lock'
    ) then
      b_waited := true;
      v_saw_state := true;
      exit;
    elsif v_busy = 0 then
      b_waited := false;
      v_saw_state := true;
      exit;
    end if;

    perform pg_catalog.pg_sleep(0.01);
  end loop;

  if not v_saw_state then
    raise exception 'test_race query B neither blocked nor completed within 1 second';
  end if;

  perform extensions.dblink_exec(v_connection_a, 'commit');
  select remote_result
    into strict result_b
    from extensions.dblink_get_result(v_connection_b)
      as remote(remote_result text);
  perform extensions.dblink_exec(v_connection_b, 'commit');

  perform extensions.dblink_disconnect(v_connection_a);
  perform extensions.dblink_disconnect(v_connection_b);
  return next;
exception
  when others then
    begin
      perform extensions.dblink_exec(v_connection_a, 'rollback');
    exception when others then null;
    end;
    begin
      perform extensions.dblink_exec(v_connection_b, 'rollback');
    exception when others then null;
    end;
    begin
      perform extensions.dblink_disconnect(v_connection_a);
    exception when others then null;
    end;
    begin
      perform extensions.dblink_disconnect(v_connection_b);
    exception when others then null;
    end;
    raise;
end;
$function$;

\if :{?osubb_test_suite}
\else
select plan(14);

insert into auth.users (id, email)
values ('e3670000-0000-0000-0000-000000000001', 'helpers.bce@test.local');
insert into public.profiles (id, full_name, email, role, status)
values ('e3670000-0000-0000-0000-000000000001', 'Helpers BCE',
        'helpers.bce@test.local', 'bce', 'activ');
insert into public.member_departments (member_id, dept_id)
values ('e3670000-0000-0000-0000-000000000001', 'edu');

select lives_ok($$
  select pg_temp.test_login(
    'e3670000-0000-0000-0000-000000000001',
    '{"provider":"email"}'::jsonb)
$$, 'test_login accepts exact claimless metadata');
select is(current_user, 'authenticated', 'test_login switches to authenticated');
select is(auth.jwt() -> 'app_metadata', '{"provider":"email"}'::jsonb,
  'test_login preserves exact claimless metadata');
select is(auth.uid(), 'e3670000-0000-0000-0000-000000000001'::uuid,
  'test_login sets the requested subject');
select lives_ok($$ select pg_temp.test_clear_jwt() $$,
  'test_clear_jwt clears claims');
select is(current_user, 'authenticated', 'test_clear_jwt preserves the SQL role');
select is(current_setting('request.jwt.claims', true), '',
  'test_clear_jwt leaves empty claims');

reset role;
select lives_ok($$
  select pg_temp.test_login(
    'e3670000-0000-0000-0000-000000000001',
    '{"member_role":"bc","member_level":99,"dept_ids":["fake"]}'::jsonb)
$$, 'test_login accepts deliberately stale or forged metadata');
select is(auth.jwt() -> 'app_metadata',
  '{"member_role":"bc","member_level":99,"dept_ids":["fake"]}'::jsonb,
  'test_login never corrects supplied metadata from the live profile');

reset role;
select lives_ok($$
  select pg_temp.test_login_leadership(
    'e3670000-0000-0000-0000-000000000001')
$$, 'test_login_leadership derives claims from fixtures');
select is(auth.jwt() -> 'app_metadata', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5,
  'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb),
  'leadership login derives role, level, Departments, and Teams');

select throws_ok($call$
  select * from pg_temp.test_race(
    $race$ select (1 / 0)::text $race$,
    $race$ select 'unused'::text $race$)
$call$, '22012', 'division by zero', 'test_race propagates query A failures');
select ok(not exists (
  select 1 from unnest(coalesce(extensions.dblink_get_connections(), '{}'::text[])) connection_name
   where connection_name like 'test_race_%'
), 'test_race disconnects both sessions after a failure');

select is((select race.result_a || ':' || race.result_b || ':' || race.b_waited
  from pg_temp.test_race(
    $$ with lock as (select pg_advisory_xact_lock(367)) select 'a'::text from lock $$,
    $$ with lock as (select pg_advisory_xact_lock(367)) select 'b'::text from lock $$
  ) as race), 'a:b:true', 'test_race runs both statements around a real lock wait');

reset role;
select * from finish();
rollback;
\endif
