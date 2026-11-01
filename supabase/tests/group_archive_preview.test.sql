-- #1149 (audit 2026-10-30, M21): public.group_archive_preview -- what archiving
-- a Group would act on, read before the confirmation as group_delete_preview is
-- read before a delete.
--
-- archive_group cancels every future Event of the subtree (attendees notified),
-- declines every pending Application (applicants notified) and archives every
-- descendant; unarchive_group (R65) restores none of it. The dialogs said only
-- "Istoricul rămâne." The preview returns the three counts under archive_group's
-- own authority (private.require_group_remover) and the group_protected
-- refusal of #1129; it reads, it never locks, and archive_group_impl is untouched.
--
-- Mutation proof: counting cancelled or past Events, or decided Applications,
-- turns the counts assertion red; dropping the require_group_remover call turns
-- the ordinary-member and Manager-of-a-root refusals red; dropping the
-- is_protected_group check turns the protected refusal red.
--
-- Personas (prefix 1149): 1 BC activ, 2 voluntar activ (ordinary member),
-- 3 voluntar activ (Manager of Rădăcină), 4 voluntar activ (an applicant),
-- 5 voluntar activ (an attendee).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.u1149(n integer) returns uuid language sql immutable as $$
  select ('11490000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u1149(n), 'preview.' || n || '.1149@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u1149(n), 'Preview #1149 ' || n, 'preview.' || n || '.1149@test.local',
       (case n when 1 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;

insert into public.groups (name, category, min_level, created_by)
values ('Rădăcină #1149', 'department', 0, pg_temp.u1149(1)),
       ('Frunză #1149',   'department', 0, pg_temp.u1149(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #1149', 'department', 0, true, pg_temp.u1149(1));

create function pg_temp.g1149(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil A #1149', 'team', pg_temp.g1149('Rădăcină #1149'), 0, pg_temp.u1149(1)),
       ('Copil B #1149', 'team', pg_temp.g1149('Rădăcină #1149'), 0, pg_temp.u1149(1));
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Nepot #1149', 'team', pg_temp.g1149('Copil A #1149'), 0, pg_temp.u1149(1));
-- An archived Child counts for nothing: the archive leaves it as it is.
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil arhivat #1149', 'team', pg_temp.g1149('Rădăcină #1149'), 0, pg_temp.u1149(1));
update public.groups set status = 'archived' where name = 'Copil arhivat #1149';

insert into public.group_members (group_id, member_id, group_role)
values (pg_temp.g1149('Rădăcină #1149'), pg_temp.u1149(3), 'manager');

-- Events: two future ones in the subtree count; a past one, a cancelled future
-- one and a future one elsewhere do not.
insert into public.events (title, type, starts_at, group_id, created_by)
values ('Viitor rădăcină #1149', 'activitate', now() + interval '5 days', pg_temp.g1149('Rădăcină #1149'), pg_temp.u1149(1)),
       ('Viitor nepot #1149',    'activitate', now() + interval '6 days', pg_temp.g1149('Nepot #1149'),    pg_temp.u1149(1)),
       ('Trecut #1149',          'activitate', now() - interval '5 days', pg_temp.g1149('Copil B #1149'),  pg_temp.u1149(1)),
       ('Străin #1149',          'activitate', now() + interval '5 days', pg_temp.g1149('Frunză #1149'),   pg_temp.u1149(1));
insert into public.events (title, type, starts_at, group_id, created_by, cancelled_at, cancel_reason)
values ('Anulat #1149', 'activitate', now() + interval '7 days', pg_temp.g1149('Copil A #1149'), pg_temp.u1149(1),
        now(), 'gata');

-- Applications: one pending in the subtree counts; a declined one does not.
insert into public.group_applications (group_id, member_id, status)
values (pg_temp.g1149('Copil A #1149'), pg_temp.u1149(4), 'pending');
insert into public.group_applications (group_id, member_id, status, decided_by, decided_at)
values (pg_temp.g1149('Copil B #1149'), pg_temp.u1149(5), 'declined', pg_temp.u1149(1), now());

-- ==================== the counts ====================

select pg_temp.test_login_leadership(pg_temp.u1149(1));
select is(
  public.group_archive_preview(pg_temp.g1149('Rădăcină #1149')),
  '{"subgroups": 3, "events": 2, "applications": 1}'::jsonb,
  'group_archive_preview: the three active descendants (never one already archived), the two future Events of the subtree, the one pending Application -- never a past or cancelled Event, a decided Application or another Group''s');
select is(
  public.group_archive_preview(pg_temp.g1149('Frunză #1149')),
  '{"subgroups": 0, "events": 1, "applications": 0}'::jsonb,
  'a leaf counts only its own future Event');
select is(
  public.group_archive_preview(pg_temp.g1149('Copil B #1149')),
  '{"subgroups": 0, "events": 0, "applications": 0}'::jsonb,
  'and a Group with nothing ahead of it reads all zeros');
reset role;
select is(
  (select count(*) from public.events where title like '%#1149' and cancelled_at is not null),
  1::bigint,
  'the preview wrote nothing: only the fixture''s own cancelled Event is cancelled');
select is(
  (select count(*) from public.group_applications as application
     join public.groups as grp on grp.id = application.group_id
    where grp.name like '%#1149' and application.status = 'pending'),
  1::bigint,
  'and the pending Application is still pending');

-- ==================== archive_group''s authority ====================

select pg_temp.test_login_leadership(pg_temp.u1149(2));
select throws_ok(
  format($$select public.group_archive_preview(%s)$$, pg_temp.g1149('Rădăcină #1149')),
  '42501', 'group_manage_forbidden', 'an ordinary member reads no preview');
reset role;

select pg_temp.test_login_leadership(pg_temp.u1149(3));
select throws_ok(
  format($$select public.group_archive_preview(%s)$$, pg_temp.g1149('Rădăcină #1149')),
  '42501', 'group_manage_forbidden', 'a top-level Group is BC''s and the Moderator''s, even for its own Manager (archive_group''s rule)');
select is(
  public.group_archive_preview(pg_temp.g1149('Copil A #1149')),
  '{"subgroups": 1, "events": 1, "applications": 1}'::jsonb,
  'while the Child Group below them is theirs to preview, as it is theirs to archive');
reset role;

select pg_temp.test_login_leadership(pg_temp.u1149(1));
select throws_ok(
  format($$select public.group_archive_preview(%s)$$, pg_temp.g1149('Automat #1149')),
  'PT409', 'group_protected', 'a protected Group answers the refusal archive_group would (#1129)');
select throws_ok($$select public.group_archive_preview(999999999)$$,
  '42501', 'group_manage_forbidden', 'an unknown Group is indistinguishable from an unauthorised one');
reset role;

set local role anon;
select throws_ok(
  format($$select public.group_archive_preview(%s)$$, pg_temp.g1149('Rădăcină #1149')),
  '42501', null, 'anon cannot execute the preview');
reset role;

select * from finish();
rollback;
