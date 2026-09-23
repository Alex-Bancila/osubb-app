-- profiles_nickname.test.sql — #675: the Nickname (R5). Charset, length and
-- trim, the case- and diacritic-insensitive collision, the self/BC write
-- matrix with full_name privileged, and the claimless, anon and inactive
-- denials. Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ==================== Structure ====================

select has_column('public', 'profiles', 'nickname', 'profiles.nickname exists');
select col_is_null('public', 'profiles', 'nickname', 'and is nullable -- empty means the full name is shown');
select col_type_is('public', 'profiles', 'nickname', 'text', 'and is text');
select has_trigger('public', 'profiles', 'profiles_guard_nickname',
  'the Nickname guard is wired to profiles');
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'profiles_nickname_fold_uidx'),
  'CREATE UNIQUE INDEX profiles_nickname_fold_uidx ON public.profiles USING btree (private.fold_nickname(nickname)) WHERE (nickname IS NOT NULL)',
  'uniqueness is a partial unique index over the folded Nickname');
select is(private.fold_nickname('  ȘTEFAN '), 'stefan',
  'the fold trims, strips diacritics and lower-cases');
select ok(has_column_privilege('authenticated', 'public.profiles', 'nickname', 'select')
          and has_column_privilege('authenticated', 'public.profiles', 'nickname', 'update'),
  'authenticated reads and writes the column; the row split stays profiles_update_self');
select ok(not has_column_privilege('anon', 'public.profiles', 'nickname', 'select')
          and not has_column_privilege('anon', 'public.profiles', 'nickname', 'update'),
  'anon holds no privilege on the column');
select is(
  (select array_agg(attribute.attname::text order by attribute.attnum)
     from pg_attribute as attribute
    where attribute.attrelid = 'public.profiles_directory'::regclass
      and attribute.attnum > 0 and not attribute.attisdropped),
  array['id', 'full_name', 'role', 'status', 'avatar_color', 'tier', 'joined_year',
        'created_at', 'joined_at', 'nickname'],
  'profiles_directory carries nickname beside full_name');

-- ==================== Fixtures — prefix 67500000-… ====================

insert into auth.users (id, email) values
  ('67500000-0000-0000-0000-000000000001', 'vol1.675@test.local'),
  ('67500000-0000-0000-0000-000000000002', 'vol2.675@test.local'),
  ('67500000-0000-0000-0000-000000000003', 'bc.675@test.local'),
  ('67500000-0000-0000-0000-000000000004', 'inactiv.675@test.local'),
  ('67500000-0000-0000-0000-000000000005', 'direct.675@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('67500000-0000-0000-0000-000000000001', 'Voluntar Unu 675',  'vol1.675@test.local',    'voluntar', 'activ'),
  ('67500000-0000-0000-0000-000000000002', 'Voluntar Doi 675',  'vol2.675@test.local',    'voluntar', 'activ'),
  ('67500000-0000-0000-0000-000000000003', 'BC 675',            'bc.675@test.local',      'bc',       'activ'),
  ('67500000-0000-0000-0000-000000000004', 'Fost Membru 675',   'inactiv.675@test.local', 'voluntar', 'inactiv'),
  ('67500000-0000-0000-0000-000000000005', 'Direct 675',        'direct.675@test.local',  'voluntar', 'activ');

create function pg_temp.nick675(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select nickname from public.profiles
   where id = ('67500000-0000-0000-0000-00000000000' || n)::uuid
$$;
create function pg_temp.as675(n integer) returns void language sql as $$
  select pg_temp.test_login(('67500000-0000-0000-0000-00000000000' || n)::uuid,
    '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[]}'::jsonb) $$;

-- ==================== Charset, length and trim (as the Member themselves) ====================

select pg_temp.as675(1);

select lives_ok(
  $$ update public.profiles set nickname = 'Ștefan_2' where id = '67500000-0000-0000-0000-000000000001' $$,
  'a Nickname with Romanian letters, a digit and "_" is accepted');
select is(pg_temp.nick675(1), 'Ștefan_2', 'and stored as written');

select throws_ok(
  $$ update public.profiles set nickname = 'Ște@fan' where id = '67500000-0000-0000-0000-000000000001' $$,
  '23514', 'nickname_invalid', 'a character outside letters, digits, space, ".", "-", "_" is nickname_invalid');
select throws_ok(
  $$ update public.profiles set nickname = 'Ana' || chr(10) || 'Pop' where id = '67500000-0000-0000-0000-000000000001' $$,
  '23514', 'nickname_invalid', 'an inner line break is nickname_invalid, not trimmed away');
select throws_ok(
  $$ update public.profiles set nickname = 'A' where id = '67500000-0000-0000-0000-000000000001' $$,
  '23514', 'nickname_too_short', 'one character is nickname_too_short');
select throws_ok(
  $$ update public.profiles set nickname = '   B   ' where id = '67500000-0000-0000-0000-000000000001' $$,
  '23514', 'nickname_too_short', 'length is judged after the trim');
select throws_ok(
  $$ update public.profiles set nickname = repeat('x', 25) where id = '67500000-0000-0000-0000-000000000001' $$,
  '23514', 'nickname_too_long', 'twenty-five characters is nickname_too_long');
select lives_ok(
  $$ update public.profiles set nickname = '  ' || repeat('ă', 24) || '  ' where id = '67500000-0000-0000-0000-000000000001' $$,
  'twenty-four characters (counted as characters, not bytes) inside edge whitespace is accepted');
select is(pg_temp.nick675(1), repeat('ă', 24), 'edge whitespace is trimmed, never rejected');

select lives_ok(
  $$ update public.profiles set nickname = '  Ana.Maria-Pop 2  ' where id = '67500000-0000-0000-0000-000000000001' $$,
  'spaces, "." and "-" are part of the charset');
select is(pg_temp.nick675(1), 'Ana.Maria-Pop 2', 'and the stored Nickname is the trimmed one');

update public.profiles set nickname = '    ' where id = '67500000-0000-0000-0000-000000000001';
select is(pg_temp.nick675(1), null, 'a blank Nickname becomes null -- the full name stands in');

-- ==================== The collision ignores case and diacritics ====================

update public.profiles set nickname = 'Ștefan' where id = '67500000-0000-0000-0000-000000000001';
reset role;

select pg_temp.as675(2);
select throws_ok(
  $$ update public.profiles set nickname = 'stefan' where id = '67500000-0000-0000-0000-000000000002' $$,
  '23514', 'nickname_taken', '"stefan" collides with another Member''s "Ștefan"');
select throws_ok(
  $$ update public.profiles set nickname = ' STEFAN ' where id = '67500000-0000-0000-0000-000000000002' $$,
  '23514', 'nickname_taken', '"STEFAN" collides too -- case is ignored');
select lives_ok(
  $$ update public.profiles set nickname = 'Ștefan 2' where id = '67500000-0000-0000-0000-000000000002' $$,
  'a Nickname that differs after folding is free');
reset role;

select pg_temp.as675(1);
select lives_ok(
  $$ update public.profiles set nickname = 'ȘTEFAN' where id = '67500000-0000-0000-0000-000000000001' $$,
  'a Member re-cases their own Nickname -- their own row is not a collision');
reset role;

-- The unique index is the guard the trigger's pre-check only names: with the
-- trigger out of the way (owner, rolled back), the index alone still refuses
-- the diacritic-insensitive duplicate, and the check constraint the charset.
alter table public.profiles disable trigger profiles_guard_nickname;
select throws_ok(
  $$ update public.profiles set nickname = 'stefan' where id = '67500000-0000-0000-0000-000000000005' $$,
  '23505', 'duplicate key value violates unique constraint "profiles_nickname_fold_uidx"',
  'the folded unique index alone refuses "stefan" beside "ȘTEFAN"');
select throws_ok(
  $$ update public.profiles set nickname = ' Edge ' where id = '67500000-0000-0000-0000-000000000005' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_nickname_ck"',
  'the check constraint alone refuses an untrimmed Nickname');
alter table public.profiles enable trigger profiles_guard_nickname;

-- ==================== The write matrix ====================

select pg_temp.as675(1);
select lives_ok(
  $$ update public.profiles set nickname = 'Unu', phone = '0711000001', avatar_color = '#284C93'
      where id = '67500000-0000-0000-0000-000000000001' $$,
  'a Voluntar updates their own Nickname, phone and avatar colour');
select throws_ok(
  $$ update public.profiles set nickname = 'Unu bis', full_name = 'Alt Nume 675'
      where id = '67500000-0000-0000-0000-000000000001' $$,
  '42501', null, 'the same update carrying a new full_name is 42501');
update public.profiles set nickname = 'Impus' where id = '67500000-0000-0000-0000-000000000002';
reset role;
select is(pg_temp.nick675(2), 'Ștefan 2',
  'a Voluntar cannot set another Member''s Nickname (the policy hides the row: zero rows, no error)');
select is(pg_temp.nick675(1), 'Unu', 'and their own refused full-name update left the Nickname unchanged');

select pg_temp.test_login('67500000-0000-0000-0000-000000000003',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
update public.profiles set nickname = 'Doi', full_name = 'Voluntar Doi Corectat 675'
 where id = '67500000-0000-0000-0000-000000000002';
reset role;
select is(
  (select format('%s|%s', nickname, full_name) from public.profiles
    where id = '67500000-0000-0000-0000-000000000002'),
  'Doi|Voluntar Doi Corectat 675', 'BC changes another Member''s Nickname and full name');

select pg_temp.test_login('67500000-0000-0000-0000-000000000003',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select throws_ok(
  $$ update public.profiles set nickname = 'unu' where id = '67500000-0000-0000-0000-000000000002' $$,
  '23514', 'nickname_taken', 'BC is held to the same uniqueness');
reset role;

-- ==================== Denials ====================

-- Claimless: a valid uid whose token carries no organization claims.
select pg_temp.test_login('67500000-0000-0000-0000-000000000005', '{}'::jsonb);
update public.profiles set nickname = 'Fara Claim' where id = '67500000-0000-0000-0000-000000000005';
reset role;
select is(pg_temp.nick675(5), null, 'a claimless session sets no Nickname, not even its own');

-- Inactive: a deactivated Member keeps their uid and row but loses their
-- claims (ADR-0003 gate 2), so their session is claimless.
select pg_temp.test_login('67500000-0000-0000-0000-000000000004', '{}'::jsonb);
update public.profiles set nickname = 'Revenit' where id = '67500000-0000-0000-0000-000000000004';
reset role;
select is(pg_temp.nick675(4), null, 'a deactivated Member sets no Nickname on the row they used to own');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ update public.profiles set nickname = 'Anonim' where id = '67500000-0000-0000-0000-000000000001' $$,
  '42501', null, 'anon writes no Nickname');
select throws_ok(
  $$ select nickname from public.profiles $$,
  '42501', null, 'and reads none');
reset role;

select * from finish();
rollback;
