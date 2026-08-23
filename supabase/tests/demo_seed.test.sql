-- demo_seed.test.sql — Epic 5.2a: the demo logins.
-- These assert `supabase/seed.sql`, which runs on `db reset` and on `start`
-- (local and staging only — never production). If you run the suite against a
-- database seeded with `--no-seed`, this file is the one that will complain.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ==================== One login per role (AC) ====================
select is((select count(*) from profiles where email like '%@demo.osubb'), 8::bigint,
  'eight demo members exist');

select is(
  (select count(distinct role) from profiles where email like '%@demo.osubb'), 8::bigint,
  'one per role — every rung of the ladder can be demoed');

select is(
  (select count(*) from profiles p
     join roles r on r.id = p.role
    where p.email like '%@demo.osubb' and r.level = 6),
  1::bigint, 'exactly one BC, so "log in as BC" is unambiguous');

-- ==================== They can actually log in ====================
-- Password auth is a demo convenience; real onboarding is passwordless
-- (ADR-0003). What matters here is that the rows GoTrue reads are well-formed.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and encrypted_password is not null),
  8::bigint, 'each demo account has a password hash');

select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and email_confirmed_at is not null),
  8::bigint, 'each demo account is confirmed, so login is not blocked');

-- The trap this test exists for: GoTrue scans these columns as NOT NULL
-- strings. Leave one null and every login fails with a 500 and "converting
-- NULL to string is unsupported" — which reads as a broken app, not a broken
-- fixture. It cost an afternoon once.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb'
      and (confirmation_token is null or recovery_token is null
        or email_change_token_new is null or email_change is null
        or email_change_token_current is null or phone_change is null
        or phone_change_token is null or reauthentication_token is null)),
  0::bigint, 'no demo account has null auth token columns (GoTrue reads them as text)');

-- ==================== Shape the screens need ====================
select ok(
  not exists (select 1 from profiles p
               where p.email like '%@demo.osubb'
                 and not exists (select 1 from member_departments md
                                  where md.member_id = p.id)),
  'every demo member belongs to at least one department');

select ok(
  (select count(distinct dept_id) from member_departments md
     join profiles p on p.id = md.member_id
    where p.email like '%@demo.osubb'
      and md.dept_id in (select id from departments where kind = 'department')) >= 3,
  'demo members span several real departments (the dept cup needs something to compare)');

select is((select count(*) from teams where id in ('t-app', 't-recruti')), 2::bigint,
  'both demo teams exist');

select is((select count(*) from teams where id = 't-recruti' and for_recruits), 1::bigint,
  'one team is open to recruits — the branch the calendar rule turns on');

select * from finish();
rollback;
