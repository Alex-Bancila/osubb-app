-- manual_awards.test.sql — #261: manual awards are retired.
-- Historical rows are not removed, but no new row may be created.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  exists (
    select 1
      from pg_trigger
     where tgname = 'points_ledger_reject_manual_award'
       and tgrelid = 'public.points_ledger'::regclass
  ),
  'points_ledger has the manual award rejection trigger');
select ok(
  not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'points_ledger'
       and (coalesce(qual, '') || coalesce(with_check, ''))
           like '%manual_award%'
  ),
  'no client policy creates manual awards');
select ok(
  has_table_privilege('authenticated', 'public.points_ledger', 'INSERT'),
  'authenticated retains INSERT only for the remaining sanction path');
select ok(
  not has_table_privilege('anon', 'public.points_ledger', 'INSERT'),
  'anonymous clients cannot insert ledger rows');

select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 10, 'manual_award') $$,
  '23514', null,
  'the trigger rejects a new manual award for the database owner');

insert into auth.users (id, email) values
  ('26100000-0000-0000-0000-000000000001', '261.bc@test.local'),
  ('26100000-0000-0000-0000-000000000002', '261.inactive@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('26100000-0000-0000-0000-000000000001', '261 BC', '261.bc@test.local', 'bc', 'activ'),
  ('26100000-0000-0000-0000-000000000002', '261 Inactive', '261.inactive@test.local', 'bc', 'inactiv');

create function pg_temp.login(uid uuid, claims jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid, 'role', 'authenticated', 'app_metadata', claims
  )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.login('26100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by)
     values ('26100000-0000-0000-0000-000000000001', 10, 'manual_award',
             '26100000-0000-0000-0000-000000000001') $$,
  '23514', null, 'an active BC cannot create a manual award through the rejection trigger');
select lives_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by)
     values ('26100000-0000-0000-0000-000000000001', -1, 'sanction',
             '26100000-0000-0000-0000-000000000001') $$,
  'an active BC may still create a sanction');

select pg_temp.login('26100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by)
     values ('26100000-0000-0000-0000-000000000002', 10, 'manual_award',
             '26100000-0000-0000-0000-000000000002') $$,
  '23514', null, 'an inactive BC cannot create a manual award');
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by)
     values ('26100000-0000-0000-0000-000000000002', -1, 'sanction',
             '26100000-0000-0000-0000-000000000002') $$,
  '42501', null, 'an inactive BC cannot create a sanction');

select pg_temp.login('26100000-0000-0000-0000-000000000001', '{}'::jsonb);
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by)
     values ('26100000-0000-0000-0000-000000000001', 10, 'manual_award',
             '26100000-0000-0000-0000-000000000001') $$,
  '23514', null, 'a claimless session cannot create a manual award');

select * from finish();
rollback;
