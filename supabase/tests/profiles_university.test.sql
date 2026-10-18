-- profiles_university.test.sql — R58 (Alex, 2026-10-18): Universitate on the
-- Profile, and only a student of Universitatea Babeș-Bolyai may be granted
-- Drept de Vot. Spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section A. Covers the column and its length/trim constraint, the canonical
-- value, the two reads that carry it, the column grants with the privileged
-- guard, and the trigger that refuses a Role change into 'vot' without UBB.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- ==================== 1. The column and its constraint ====================

select has_column('public', 'profiles', 'university', 'profiles.university exists');
select col_type_is('public', 'profiles', 'university', 'text', 'and is text');
select col_is_null('public', 'profiles', 'university', 'and is nullable -- null means unknown');
select has_trigger('public', 'profiles', 'profiles_guard_vote_university',
  'the Drept de Vot university rule is wired to profiles');
select is(private.ubb_university(), 'Universitatea Babeș-Bolyai', 'the canonical value');
select ok(
  (select procedure.provolatile = 'i'
     from pg_proc as procedure where procedure.oid = 'private.ubb_university()'::regprocedure),
  'private.ubb_university() is immutable');
select ok(
  not has_function_privilege('authenticated', 'private.ubb_university()', 'execute')
  and not has_function_privilege('anon', 'private.ubb_university()', 'execute')
  and not has_function_privilege('service_role', 'private.ubb_university()', 'execute'),
  'no client role executes the canonical-value function');

-- ==================== 2. Fixtures — prefix 58580000-… ====================
-- 1 bc; 2 activ at UBB; 3 activ at another university; 4 activ, university unknown.

create function pg_temp.u58(n integer) returns uuid language sql immutable as $$
  select ('58580000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.univ58(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select university from public.profiles where id = pg_temp.u58(n) $$;
create function pg_temp.email58(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select email from public.profiles where id = pg_temp.u58(n) $$;
create function pg_temp.role58(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select role::text from public.profiles where id = pg_temp.u58(n) $$;

insert into auth.users (id, email) values
  (pg_temp.u58(1), 'bc.58@test.local'),
  (pg_temp.u58(2), 'ubb.58@test.local'),
  (pg_temp.u58(3), 'other.58@test.local'),
  (pg_temp.u58(4), 'unknown.58@test.local'),
  (pg_temp.u58(5), 'imported.58@test.local');
insert into public.profiles (id, full_name, email, role, status, university) values
  (pg_temp.u58(1), 'BC 58',                'bc.58@test.local',      'bc',    'activ', null),
  (pg_temp.u58(2), 'Student UBB 58',         'ubb.58@test.local',     'activ', 'activ', 'Universitatea Babeș-Bolyai'),
  (pg_temp.u58(3), 'Student Altă 58',        'other.58@test.local',   'activ', 'activ', 'Universitatea Tehnică din Cluj-Napoca'),
  (pg_temp.u58(4), 'Student Necunoscut 58', 'unknown.58@test.local', 'activ', 'activ', null);

select throws_ok(
  $$ update public.profiles set university = 'U' where id = pg_temp.u58(2) $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_university_length_ck"',
  'one character is too short');
select throws_ok(
  $$ update public.profiles set university = ' Universitatea X' where id = pg_temp.u58(2) $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_university_length_ck"',
  'leading whitespace is refused: the value is stored trimmed');
select throws_ok(
  $$ update public.profiles set university = 'Universitatea X ' where id = pg_temp.u58(2) $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_university_length_ck"',
  'trailing whitespace is refused');
select throws_ok(
  $$ update public.profiles set university = repeat('x', 121) where id = pg_temp.u58(2) $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_university_length_ck"',
  '121 characters is too long');
select lives_ok(
  $$ update public.profiles set university = repeat('x', 120) where id = pg_temp.u58(3) $$,
  '120 characters is the longest accepted');
select lives_ok(
  $$ update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.u58(3) $$,
  'and an ordinary university is accepted');

-- ==================== 3. The reads ====================

select is((select university from public.profiles_directory where id = pg_temp.u58(2)),
  'Universitatea Babeș-Bolyai', 'profiles_directory carries the university');
select is(
  (select attribute.attname::text
     from pg_attribute as attribute
    where attribute.attrelid = 'public.profiles_directory'::regclass
      and attribute.attnum > 0 and not attribute.attisdropped
    order by attribute.attnum desc limit 1),
  'university', 'and university is its last column');
select is(
  (select array_agg(attribute.attname::text order by attribute.attnum)
     from pg_attribute as attribute
    where attribute.attrelid = 'public.profiles_directory'::regclass
      and attribute.attnum > 0 and not attribute.attisdropped),
  array['id', 'full_name', 'role', 'status', 'avatar_color',
        'created_at', 'joined_at', 'nickname', 'board_title', 'university'],
  'the earlier directory columns keep their order');
select ok(
  has_table_privilege('authenticated', 'public.profiles_directory', 'select')
  and not has_table_privilege('anon', 'public.profiles_directory', 'select')
  and not has_table_privilege('service_role', 'public.profiles_directory', 'select'),
  'the directory stays readable by authenticated alone');

-- ==================== 4. Column grants ====================

select ok(has_column_privilege('authenticated', 'public.profiles', 'university', 'select'),
  'authenticated reads the column');
select ok(has_column_privilege('authenticated', 'public.profiles', 'university', 'update'),
  'authenticated holds update on it: the privileged guard decides who writes');
select ok(not has_column_privilege('anon', 'public.profiles', 'university', 'select')
          and not has_column_privilege('anon', 'public.profiles', 'university', 'update'),
  'anon holds no privilege on the column');

-- ==================== 5. The privileged guard ====================

select pg_temp.test_login_leadership(pg_temp.u58(2));

select is((select university from public.member_card(pg_temp.u58(2))),
  'Universitatea Babeș-Bolyai', 'the Member Card carries the university');
select throws_ok(
  $$ update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.u58(2) $$,
  '42501',
  'Only BC (level >= 6) may change full_name, role, status, email, joined_at or university on a profile',
  'a Member below BC cannot change their own university');
select lives_ok(
  $$ update public.profiles set university = university where id = pg_temp.u58(2) $$,
  'a write that leaves the university as it was passes the guard');
select is(pg_temp.univ58(2), 'Universitatea Babeș-Bolyai', 'and the value is untouched');

select pg_temp.test_login_leadership(pg_temp.u58(1));

select lives_ok(
  $$ update public.profiles set university = 'Universitatea de Vest din Timișoara' where id = pg_temp.u58(3) $$,
  'BC changes another Member''s university');
select is(pg_temp.univ58(3), 'Universitatea de Vest din Timișoara', 'and it lands');

-- ==================== 6. The rule: Drept de Vot needs UBB ====================

select is(
  (select role::text from public.set_member_role(pg_temp.u58(2), 'vot')),
  'vot', 'BC grants Drept de Vot to a UBB student');
select throws_ok(
  $$ select public.set_member_role(pg_temp.u58(3), 'vot') $$,
  'PT409', 'vote_requires_ubb_student',
  'BC cannot grant Drept de Vot to a student of another university');
select throws_ok(
  $$ select public.set_member_role(pg_temp.u58(4), 'vot') $$,
  'PT409', 'vote_requires_ubb_student',
  'nor to a Member whose university is unknown');
select is(pg_temp.role58(4), 'activ', 'and the refused Role change leaves the Role as it was');

reset role;

select throws_ok(
  $$ update public.profiles set role = 'vot' where id = pg_temp.u58(4) $$,
  'PT409', 'vote_requires_ubb_student',
  'the rule binds any writer, the owner included');
select lives_ok(
  $$ update public.profiles set role = 'voluntar' where id = pg_temp.u58(4) $$,
  'a Role change that is not into vot never meets the rule');
select lives_ok(
  $$ update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.u58(2) $$,
  'a voter''s university can change afterwards: the rule is on the grant only');
select lives_ok(
  $$ update public.profiles set role = 'vot' where id = pg_temp.u58(2) $$,
  'and a write that keeps the Role vot does not re-ask');
select lives_ok(
  $$ insert into public.profiles (id, full_name, email, role, status, university)
     values (pg_temp.u58(5), 'Votant Importat 58', 'imported.58@test.local', 'vot', 'activ', null) $$,
  'provisioning a voter by insert with no university is outside the rule (R58, Later)');
select lives_ok(
  $$ update public.profiles set role = 'activ' where id = pg_temp.u58(5) $$,
  'and that voter can be moved to another Role without a university');

-- ==================== 7. service_role ====================
-- The privileged guard lets every role that is not a client role through
-- before it asks private.caller_level(), a schema service_role has no usage
-- on. The Edge Functions (reinvite-member, the import) write guarded columns
-- as service_role.

set local role service_role;

select lives_ok(
  $$ update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.u58(4) $$,
  'service_role writes a Member''s university: the guard exits before it asks for a level');
select is(pg_temp.univ58(4), 'Universitatea Tehnică din Cluj-Napoca', 'and it lands');
select lives_ok(
  $$ update public.profiles set email = 'renamed.58@test.local' where id = pg_temp.u58(2) $$,
  'service_role writes a Member''s email through the same branch (reinvite-member)');
select is(pg_temp.email58(2), 'renamed.58@test.local', 'and it lands too');
select throws_ok(
  $$ update public.profiles set role = 'vot' where id = pg_temp.u58(4) $$,
  'PT409', 'vote_requires_ubb_student',
  'service_role cannot grant Drept de Vot to a non-UBB Member either');

reset role;

select * from finish();
rollback;
