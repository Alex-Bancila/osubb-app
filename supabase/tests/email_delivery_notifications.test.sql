-- email_delivery_notifications.test.sql -- #776: a Resend bounce, complaint
-- or suppression becomes one system Notification for every live active BC
-- and Moderator, deduped per address per Bucharest day.
-- Runs in one transaction and rolls back -- leaves no residue in the local db.
--
-- The seed carries its own BC and Moderator, so recipient counts are read from
-- the live roster rather than pinned; per-fixture assertions pin the rest.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ==================== Structure and grants ====================
select ok(
  (select prosecdef from pg_proc
    where oid = 'public.notify_email_delivery_problem(text, text, text, text)'::regprocedure),
  'the wrapper is security definer: service_role has no usage on private, so an invoker wrapper could never reach the body');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     where has_function_privilege(grantee, 'public.notify_email_delivery_problem(text, text, text, text)', 'execute')
  ),
  array['service_role'],
  'only service_role (the resend-webhook function''s secret-key client) may execute the wrapper');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     where has_function_privilege(grantee, 'private.notify_email_delivery_problem_impl(text, text, text, text)', 'execute')
  ),
  '{}'::text[],
  'nobody may execute the body directly -- only the wrapper, as its owner');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('f7760000-0000-0000-0000-000000000001', 'ana.bounce@test.local'),
  ('f7760000-0000-0000-0000-000000000002', 'bc.activ@test.local'),
  ('f7760000-0000-0000-0000-000000000003', 'moderator@test.local'),
  ('f7760000-0000-0000-0000-000000000004', 'bce@test.local'),
  ('f7760000-0000-0000-0000-000000000005', 'bc.inactiv@test.local'),
  ('f7760000-0000-0000-0000-000000000006', 'dan.other@test.local'),
  -- A legacy case variant of Ana's address, with a LOWER id: the lookup must
  -- still pick the exact lowercase row, not the first by id.
  ('f7760000-0000-0000-0000-000000000000', 'Ana.Bounce@Test.Local');
insert into profiles (id, full_name, email, role, status) values
  ('f7760000-0000-0000-0000-000000000001', 'Ana Bounce', 'ana.bounce@test.local', 'voluntar', 'activ'),
  ('f7760000-0000-0000-0000-000000000002', 'Bianca BC', 'bc.activ@test.local', 'bc', 'activ'),
  ('f7760000-0000-0000-0000-000000000003', 'Mihai Moderator', 'moderator@test.local', 'moderator', 'activ'),
  ('f7760000-0000-0000-0000-000000000004', 'Elena BCE', 'bce@test.local', 'bce', 'activ'),
  ('f7760000-0000-0000-0000-000000000005', 'Radu Inactiv', 'bc.inactiv@test.local', 'bc', 'inactiv'),
  ('f7760000-0000-0000-0000-000000000006', 'Dan Other', 'dan.other@test.local', 'voluntar', 'activ'),
  ('f7760000-0000-0000-0000-000000000000', 'Ana Legacy', 'Ana.Bounce@Test.Local', 'voluntar', 'activ');

create temporary table expected_recipients as
  select count(*)::int as n
    from profiles as profile
    join roles as role on role.id = profile.role
   where profile.status = 'activ' and role.level >= 6;
grant select on expected_recipients to service_role, authenticated;

create function pg_temp.today_key(p_email text) returns text
language sql stable as $$
  select 'email_delivery:' || p_email || ':'
         || to_char(now() at time zone 'Europe/Bucharest', 'YYYY-MM-DD')
$$;

create function pg_temp.about(p_member uuid) returns bigint
language sql stable as $$
  select count(*) from notifications
   where link = '/administrare/membri/' || p_member::text
$$;

-- ==================== An ordinary Member cannot call it ====================
select pg_temp.test_login('f7760000-0000-0000-0000-000000000001',
  '{"role": "voluntar", "level": 1, "groups": []}'::jsonb);
select throws_ok(
  $$select public.notify_email_delivery_problem('msg_83', 'ana.bounce@test.local', 'email.bounced', 'x')$$,
  '42501', null,
  'an ordinary Member cannot execute the wrapper');
select pg_temp.test_clear_jwt();
reset role;

-- ==================== A bounce, through service_role ====================
set local role service_role;
select is(
  public.notify_email_delivery_problem(
    'msg_93', '  ANA.Bounce@Test.Local ', 'email.bounced',
    'The recipient''s email address is on the suppression list.'),
  (select n from expected_recipients),
  'a bounce notifies every live active level >= 6 Member and returns how many -- the address matched case-insensitively and trimmed');
reset role;

select is(
  (select count(*)::int from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and kind = 'system'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')
      and link = '/administrare/membri/f7760000-0000-0000-0000-000000000001'),
  1,
  'the BC gets one system Notification, keyed email_delivery:<lower address>:<Bucharest day>, linking to the Member''s Administrare page');

select is(
  (select count(*)::int from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000003'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')),
  1,
  'the Moderator gets one too');

select is(
  (select count(*)::int from notifications
    where member_id in ('f7760000-0000-0000-0000-000000000004',
                        'f7760000-0000-0000-0000-000000000005',
                        'f7760000-0000-0000-0000-000000000001')
      and link = '/administrare/membri/f7760000-0000-0000-0000-000000000001'),
  0,
  'BCE (level 5), an inactive BC and the Member themselves get nothing');

select is(
  pg_temp.about('f7760000-0000-0000-0000-000000000000')::int,
  0,
  'a legacy case variant of the address (lower id) is not picked: the exact lowercase row wins, deterministically');

select is(
  (select title from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')),
  'Email respins: Ana Bounce',
  'the bounce title names the Member');

select ok(
  (select body like '%ana.bounce@test.local%'
          and body like '%Detalii Resend: The recipient''s email address is on the suppression list.'
     from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')),
  'the body names the address and carries Resend''s reason');

-- ==================== Dedupe per address per day ====================
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_147', 'ana.bounce@test.local', 'email.suppressed', 'suppressed'),
  0,
  'a second event for the same address the same day writes nothing');
reset role;

select is(
  pg_temp.about('f7760000-0000-0000-0000-000000000001')::int,
  (select n from expected_recipients),
  'still one Notification per recipient about that address');

update notifications set read = true
 where dedupe_key = pg_temp.today_key('ana.bounce@test.local');
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_161', 'ana.bounce@test.local', 'email.complained', null),
  0,
  'a Notification already read still counts: the day''s key is never written twice');
reset role;

-- The key carries the day: a Notification keyed on another day does not
-- suppress today's. (Mutating the key to drop the date turns this red.)
update notifications set dedupe_key = 'email_delivery:ana.bounce@test.local:2026-01-01'
 where dedupe_key = pg_temp.today_key('ana.bounce@test.local');
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_172', 'ana.bounce@test.local', 'email.complained', null),
  (select n from expected_recipients),
  'yesterday''s key does not stop today''s Notification');
reset role;

select is(
  (select title from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')),
  'Email marcat ca spam: Ana Bounce',
  'the complaint title names the Member');

select ok(
  (select body not like '%Detalii Resend%'
     from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('ana.bounce@test.local')),
  'no reason, no "Detalii Resend" line');

-- ==================== Once per Resend delivery (svix-id) ====================
-- A replay of msg_172 once today's key is out of the way -- a retry landing
-- the next Bucharest day -- must still write nothing: the delivery record,
-- not the per-day key, is what stops it. (Dropping the delivery record turns
-- this red.)
update notifications set dedupe_key = 'email_delivery:ana.bounce@test.local:2026-01-02'
 where dedupe_key = pg_temp.today_key('ana.bounce@test.local');
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_172', 'ana.bounce@test.local', 'email.complained', null),
  0,
  'the same svix-id for the same address twice notifies once, even where the per-day key would let it through');
reset role;
update notifications set dedupe_key = pg_temp.today_key('ana.bounce@test.local')
 where dedupe_key = 'email_delivery:ana.bounce@test.local:2026-01-02';

-- One event can name several recipients: the handler calls once per address
-- with the same svix-id, and each address is its own record.
set local role service_role;
do $do$ begin perform public.notify_email_delivery_problem('msg_multi', 'first@resend.dev', 'email.bounced', null); end $do$;
do $do$ begin perform public.notify_email_delivery_problem('msg_multi', 'second@resend.dev', 'email.bounced', null); end $do$;
reset role;
select is(
  (select count(*)::int from private.resend_webhook_deliveries where delivery_id = 'msg_multi'),
  2,
  'one delivery id is recorded once per recipient address, so a multi-recipient event reports every address');

insert into private.resend_webhook_deliveries (delivery_id, email, received_at)
values ('msg_old', 'old@resend.dev', now() - interval '8 days');
set local role service_role;
do $do$ begin perform public.notify_email_delivery_problem('msg_purge', 'purge@resend.dev', 'email.bounced', null); end $do$;
reset role;
select is(
  (select count(*)::int from private.resend_webhook_deliveries where delivery_id = 'msg_old'),
  0,
  'delivery records older than seven days are purged on the way in');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     where has_table_privilege(grantee, 'private.resend_webhook_deliveries', 'select, insert, update, delete')
  ),
  '{}'::text[],
  'nobody but the definer body reads or writes the delivery records');

select ok(
  (select relrowsecurity from pg_class where oid = 'private.resend_webhook_deliveries'::regclass),
  'the delivery records table has RLS enabled (house rule 2)');

-- The key carries the address: another Member's bounce the same day is new.
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_194', 'dan.other@test.local', 'email.suppressed', 'OnAccountSuppressionList'),
  (select n from expected_recipients),
  'another address the same day is its own Notification');
reset role;

select is(
  (select title from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('dan.other@test.local')),
  'Email blocat: Dan Other',
  'the suppression title names the Member');

-- ==================== Unknown address and bad input ====================
create temporary table notifications_before as select count(*)::int as n from notifications;
grant select on notifications_before to service_role;

set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_212', 'bounced@resend.dev', 'email.bounced', 'test'),
  0,
  'an address no profile carries returns 0 and raises nothing');
reset role;

select is(
  (select count(*)::int from notifications),
  (select n from notifications_before),
  'and writes nothing');

set local role service_role;
select throws_ok(
  $$select public.notify_email_delivery_problem('msg_224', 'ana.bounce@test.local', 'email.delivered', null)$$,
  'PT400', 'invalid_email_event',
  'an event outside bounced/complained/suppressed is refused');
select throws_ok(
  $$select public.notify_email_delivery_problem('msg_228', '   ', 'email.bounced', null)$$,
  'PT400', 'email_required',
  'a blank address is refused');
select throws_ok(
  $$select public.notify_email_delivery_problem('msg_232', null, 'email.bounced', null)$$,
  'PT400', 'email_required',
  'a null address is refused');
select throws_ok(
  $$select public.notify_email_delivery_problem('  ', 'ana.bounce@test.local', 'email.bounced', null)$$,
  'PT400', 'invalid_delivery_id',
  'a blank delivery id (svix-id) is refused');
reset role;

-- A long reason is cut so one Notification stays readable.
delete from notifications where dedupe_key = pg_temp.today_key('dan.other@test.local');
set local role service_role;
select is(
  public.notify_email_delivery_problem('msg_241', 'dan.other@test.local', 'email.bounced', repeat('x', 1000)),
  (select n from expected_recipients),
  'a long reason is accepted');
reset role;
select is(
  (select length(substring(body from 'Detalii Resend: (.*)$')) from notifications
    where member_id = 'f7760000-0000-0000-0000-000000000002'
      and dedupe_key = pg_temp.today_key('dan.other@test.local')),
  300,
  'and cut to 300 characters');

select * from finish();
rollback;
