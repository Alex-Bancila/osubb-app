-- #1151 (decision 7 of #1144): a read Notification delivered more than 90
-- days ago is purged by the daily job osubb-purge-notifications; an unread
-- one never is. private.told_of and the subject deletes have their indexes.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Every call goes through these, so on a schema without the purge each
-- assertion fails by name instead of the suite stopping at the first call.
create function pg_temp.purge(p_batch_size integer) returns bigint language plpgsql as $$
declare
  v_deleted bigint;
begin
  if to_regprocedure('private.purge_read_notifications(integer)') is null then
    return null;
  end if;
  execute 'select private.purge_read_notifications($1)' into v_deleted using p_batch_size;
  return v_deleted;
end;
$$;
create function pg_temp.run_job() returns void language plpgsql as $$
declare
  v_command text := (select command from cron.job where jobname = 'osubb-purge-notifications');
begin
  if v_command is not null then
    execute v_command;
  end if;
end;
$$;

-- ==================== the job ====================
select is((select count(*)::int from cron.job
            where jobname = 'osubb-purge-notifications' and schedule = '30 3 * * *'
              and command = 'select private.purge_read_notifications()' and active), 1,
  'one active job purges read Notifications daily at 03:30');
select ok(case when to_regprocedure('private.purge_read_notifications(integer)') is null then false
               else not has_function_privilege('authenticated', 'private.purge_read_notifications(integer)', 'execute')
                    and not has_function_privilege('anon', 'private.purge_read_notifications(integer)', 'execute')
                    and not has_function_privilege('service_role', 'private.purge_read_notifications(integer)', 'execute')
          end,
  'the purge exists and no client role may run it');

-- ==================== the indexes ====================
select is((select indexdef from pg_indexes
            where schemaname = 'public' and indexname = 'notifications_member_dedupe_key_idx'),
  'CREATE INDEX notifications_member_dedupe_key_idx ON public.notifications USING btree (member_id, dedupe_key text_pattern_ops)',
  'private.told_of has its index: a recipient''s keys, LIKE-prefix searchable');
select is((select indexdef from pg_indexes
            where schemaname = 'public' and indexname = 'notifications_subject_idx'),
  'CREATE INDEX notifications_subject_idx ON public.notifications USING btree (subject)',
  'the subject deletes have their index');

-- ==================== the purge ====================
-- Two Members (prefix 1151). now() is fixed for the transaction, so "exactly
-- 90 days ago" is exactly the cutoff.
insert into auth.users (id, email) values
  ('11510000-0000-0000-0000-000000000001', 'purge.1.1151@test.local'),
  ('11510000-0000-0000-0000-000000000002', 'purge.2.1151@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('11510000-0000-0000-0000-000000000001', 'Purge 1151 1', 'purge.1.1151@test.local', 'voluntar', 'activ'),
  ('11510000-0000-0000-0000-000000000002', 'Purge 1151 2', 'purge.2.1151@test.local', 'voluntar', 'activ');
insert into notifications (member_id, kind, title, read, created_at)
select member_id::uuid, 'system', title, read, now() - age
  from (values
    ('11510000-0000-0000-0000-000000000001', 'Old read A #1151',   true,  interval '91 days'),
    ('11510000-0000-0000-0000-000000000001', 'Old read B #1151',   true,  interval '400 days'),
    ('11510000-0000-0000-0000-000000000001', 'Old read C #1151',   true,  interval '91 days'),
    ('11510000-0000-0000-0000-000000000001', 'Day 90 read #1151',  true,  interval '90 days'),
    ('11510000-0000-0000-0000-000000000001', 'New read #1151',     true,  interval '10 days'),
    ('11510000-0000-0000-0000-000000000001', 'Old unread #1151',   false, interval '400 days'),
    ('11510000-0000-0000-0000-000000000001', 'New unread #1151',   false, interval '1 day'),
    ('11510000-0000-0000-0000-000000000002', 'Old read D #1151',   true,  interval '91 days')
  ) as fixture(member_id, title, read, age);

-- Anything else the database holds that the purge would also take.
create temp table others_due as
select count(*) as n from notifications
 where read and created_at < now() - interval '90 days' and member_id::text not like '11510000-%';

create function pg_temp.left_of(p_title text) returns integer language sql stable as $$
  select count(*)::int from notifications where title = p_title and member_id::text like '11510000-%'
$$;

select is(pg_temp.purge(2), 4 + (select n from others_due),
  'one run, two rows at a time, deletes the four read Notifications delivered more than 90 days ago');
select is((select count(*)::int from notifications where title like 'Old read % #1151'), 0,
  'read and delivered more than 90 days ago: gone, for every Member');
select is(pg_temp.left_of('Old unread #1151') + pg_temp.left_of('New unread #1151'), 2,
  'an unread Notification is never purged, however old');
select is(pg_temp.left_of('Day 90 read #1151'), 1,
  'a read Notification delivered exactly 90 days ago stays');
select is(pg_temp.left_of('New read #1151'), 1,
  'a read Notification from the last 90 days stays');
select is(pg_temp.purge(null), 0::bigint,
  'a second run finds nothing left (a null batch size is the default)');

-- The job's own command.
insert into notifications (member_id, kind, title, read, created_at)
values ('11510000-0000-0000-0000-000000000002', 'system', 'Old read E #1151', true, now() - interval '200 days'),
       ('11510000-0000-0000-0000-000000000002', 'system', 'Old unread E #1151', false, now() - interval '200 days');
select pg_temp.run_job();
select is(pg_temp.left_of('Old read E #1151'), 0,
  'the job''s command purges an old read Notification');
select is(pg_temp.left_of('Old unread E #1151'), 1,
  'and leaves an old unread one');

select * from finish();
rollback;
