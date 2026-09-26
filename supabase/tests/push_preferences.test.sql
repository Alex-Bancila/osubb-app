-- #635: per-Member push preferences -- self-only policies across personas,
-- the kinds that can never be muted, and the enqueue trigger's skip and
-- critical override (ADR-0010).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(42);

create function pg_temp.u635(n integer) returns uuid language sql immutable as $$
  select ('63500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- 1 self, 2 another Member, 3 BC, 4 inactive with stale claims,
-- 5 the muted recipient, 6 an untouched recipient (and Announcement author).
insert into auth.users (id, email)
select pg_temp.u635(n), 'push.' || n || '.635@test.local' from generate_series(1, 6) as n;
insert into profiles (id, full_name, email, role, status)
select pg_temp.u635(n), 'Push #635 ' || n, 'push.' || n || '.635@test.local',
       (case when n = 3 then 'bc' else 'voluntar' end)::member_role,
       (case when n = 4 then 'inactiv' else 'activ' end)::member_status
  from generate_series(1, 6) as n;

insert into notification_push_preferences (member_id, kind, push_enabled) values
  (pg_temp.u635(2), 'announce', false),
  (pg_temp.u635(4), 'event', false);

-- ==================== Self ====================
select pg_temp.test_login_leadership(pg_temp.u635(1));
select lives_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'announce', false)$$,
  'a Member mutes a kind for themselves');
select is((select count(*) from notification_push_preferences), 1::bigint,
  'a Member reads only their own preferences');
select lives_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'announce', true)
    on conflict (member_id, kind) do update set push_enabled = excluded.push_enabled$$,
  'a Member upserts their own preference (the switch''s write)');
select is((select push_enabled from notification_push_preferences where member_id = pg_temp.u635(1) and kind = 'announce'),
  true, 'the upsert turned the kind back on');
with changed as (update notification_push_preferences set push_enabled = false where kind = 'announce' returning member_id)
select is((select count(*) from changed), 1::bigint, 'a Member updates only their own row');
select is((select push_enabled from notification_push_preferences where member_id = pg_temp.u635(1) and kind = 'announce'),
  false, 'the update landed on the Member''s own row');
select throws_ok(
  format($$insert into notification_push_preferences (member_id, kind, push_enabled) values (%L, 'event', false)$$, pg_temp.u635(2)),
  '42501', null, 'a Member cannot write another Member''s preference');
with deleted as (delete from notification_push_preferences where member_id = pg_temp.u635(2) returning member_id)
select is((select count(*) from deleted), 0::bigint, 'a Member cannot delete another Member''s preference');
select throws_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'task', false)$$,
  '23514', 'new row for relation "notification_push_preferences" violates check constraint "notification_push_preferences_kind_ck"',
  'a Task preference is rejected: Task Notifications always push');
select throws_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'system', false)$$,
  '23514', 'new row for relation "notification_push_preferences" violates check constraint "notification_push_preferences_kind_ck"',
  'a system preference is rejected: system Notifications always push');
select throws_ok(
  $$update notification_push_preferences set kind = 'task' where member_id = auth.uid()$$,
  '23514', 'new row for relation "notification_push_preferences" violates check constraint "notification_push_preferences_kind_ck"',
  'an existing row cannot be turned into a Task preference either');
select lives_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'event', false), (auth.uid(), 'deadline', false)$$,
  'event and deadline are mutable');
with deleted as (delete from notification_push_preferences where member_id = auth.uid() and kind = 'deadline' returning member_id)
select is((select count(*) from deleted), 1::bigint, 'a Member deletes their own row (back to the default: on)');
reset role;

-- ==================== Another Member ====================
select pg_temp.test_login_leadership(pg_temp.u635(2));
select results_eq(
  $$select member_id, kind::text from notification_push_preferences$$,
  format($$values (%L::uuid, 'announce'::text)$$, pg_temp.u635(2)),
  'another Member reads only their own row, not the first Member''s');
with changed as (update notification_push_preferences set push_enabled = true where member_id = pg_temp.u635(1) returning member_id)
select is((select count(*) from changed), 0::bigint, 'another Member cannot update the first Member''s rows');
reset role;

-- ==================== BC ====================
select pg_temp.test_login_leadership(pg_temp.u635(3));
select is((select count(*) from notification_push_preferences), 0::bigint, 'BC reads no one else''s preferences');
-- No WHERE and no RETURNING: only then does the UPDATE/DELETE policy judge
-- the rows on its own, without the SELECT policy filtering them first. The
-- table-owner check after the anon block proves nothing changed.
select lives_ok($$update notification_push_preferences set push_enabled = true$$,
  'BC''s blanket update runs (and must touch nothing)');
select lives_ok($$delete from notification_push_preferences$$,
  'BC''s blanket delete runs (and must touch nothing)');
select throws_ok(
  format($$insert into notification_push_preferences (member_id, kind, push_enabled) values (%L, 'event', false)$$, pg_temp.u635(1)),
  '42501', null, 'BC cannot write a preference for another Member');
reset role;

-- ==================== Inactive Member with stale claims ====================
select pg_temp.test_login(pg_temp.u635(4),
  '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb);
select is((select count(*) from notification_push_preferences), 0::bigint,
  'an inactive Member with stale claims reads not even their own row');
with changed as (update notification_push_preferences set push_enabled = true returning member_id)
select is((select count(*) from changed), 0::bigint, 'an inactive Member with stale claims updates nothing');
with deleted as (delete from notification_push_preferences returning member_id)
select is((select count(*) from deleted), 0::bigint, 'an inactive Member with stale claims deletes nothing');
select throws_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'deadline', false)$$,
  '42501', null, 'an inactive Member with stale claims cannot write');
reset role;

-- ==================== Claimless owner ====================
select pg_temp.test_login(pg_temp.u635(2), '{}'::jsonb);
select is((select count(*) from notification_push_preferences), 0::bigint, 'a claimless session reads nothing, own row included');
with changed as (update notification_push_preferences set push_enabled = true returning member_id)
select is((select count(*) from changed), 0::bigint, 'a claimless session updates nothing');
with deleted as (delete from notification_push_preferences returning member_id)
select is((select count(*) from deleted), 0::bigint, 'a claimless session deletes nothing');
select throws_ok(
  $$insert into notification_push_preferences (member_id, kind, push_enabled) values (auth.uid(), 'event', false)$$,
  '42501', null, 'a claimless session cannot write');
reset role;

-- ==================== anon ====================
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$select * from notification_push_preferences$$, '42501', null, 'anon cannot read preferences');
select throws_ok(
  format($$insert into notification_push_preferences (member_id, kind, push_enabled) values (%L, 'event', false)$$, pg_temp.u635(1)),
  '42501', null, 'anon cannot write preferences');
reset role;

select results_eq(
  $$select member_id, kind::text, push_enabled from notification_push_preferences
     where member_id::text like '63500000-%' order by member_id, kind$$,
  format($$values (%L::uuid, 'announce'::text, false), (%L::uuid, 'event'::text, false),
                  (%L::uuid, 'announce'::text, false), (%L::uuid, 'event'::text, false)$$,
         pg_temp.u635(1), pg_temp.u635(1), pg_temp.u635(2), pg_temp.u635(4)),
  'every row is as its owner left it: no other persona updated or deleted one');

-- ==================== The push step ====================
insert into push_tokens (member_id, token, platform) values
  (pg_temp.u635(5), '{"endpoint":"https://push.example/635-muted"}', 'web'),
  (pg_temp.u635(6), '{"endpoint":"https://push.example/635-default"}', 'web');
insert into notification_push_preferences (member_id, kind, push_enabled) values
  (pg_temp.u635(5), 'announce', false),
  (pg_temp.u635(5), 'event', false),
  (pg_temp.u635(5), 'deadline', true);

create function pg_temp.in_app(p_member uuid, p_title text) returns bigint language sql as $$
  select count(*) from public.notifications where member_id = p_member and title = p_title
$$;
create function pg_temp.pushes(p_member uuid, p_title text) returns bigint language sql as $$
  select count(*)
    from public.push_deliveries as delivery
    join public.notifications as notification on notification.id = delivery.notification_id
   where notification.member_id = p_member and notification.title = p_title
$$;

select private.notify(array[pg_temp.u635(5)], 'event', 'Eveniment 635', null, null, null, null);
select is(pg_temp.in_app(pg_temp.u635(5), 'Eveniment 635'), 1::bigint, 'a muted event still writes the in-app row');
select is(pg_temp.pushes(pg_temp.u635(5), 'Eveniment 635'), 0::bigint, 'a muted event writes no outbox row');

select private.notify(array[pg_temp.u635(5)], 'deadline', 'Termen 635', null, null, null, null);
select is(pg_temp.pushes(pg_temp.u635(5), 'Termen 635'), 1::bigint,
  'a kind the Member explicitly kept on pushes');

select private.notify(array[pg_temp.u635(5)], 'task', 'Task 635', null, null, null, null);
select is(pg_temp.pushes(pg_temp.u635(5), 'Task 635'), 1::bigint,
  'a Task Notification pushes to a Member who muted every mutable kind');

select private.notify(array[pg_temp.u635(6)], 'event', 'Eveniment 635', null, null, null, null);
select is(pg_temp.pushes(pg_temp.u635(6), 'Eveniment 635'), 1::bigint,
  'an absent row means enabled: the same event pushes to a Member without preferences');

select private.notify(array[pg_temp.u635(5)], 'event', 'Eveniment critic 635', null, null, null, null, null, true);
select is(pg_temp.pushes(pg_temp.u635(5), 'Eveniment critic 635'), 1::bigint,
  'a critical Notification ignores the preference');

-- Announcements through the real fan-out: u(5) is on the Group's roster, u(6)
-- is the author and so receives nothing.
insert into groups (name, category) values ('Push #635', 'team');
insert into group_members (group_id, member_id, group_role)
select id, pg_temp.u635(5), 'member' from groups where name = 'Push #635';
insert into announcements (title, body, group_id, audience, created_by, priority)
select title, 'Corp #635', grp.id, 'local', pg_temp.u635(6), priority::announce_priority
  from groups as grp,
       (values ('Normal 635', 'normal'), ('Important 635', 'important'), ('Critic 635', 'critical')) as a (title, priority)
 where grp.name = 'Push #635';

select is(pg_temp.in_app(pg_temp.u635(5), 'Anunț nou: Normal 635'), 1::bigint,
  'a normal Announcement writes the in-app row for a Member who muted announce');
select is(pg_temp.pushes(pg_temp.u635(5), 'Anunț nou: Normal 635'), 0::bigint,
  'muting announce skips the push of a normal Announcement');
select is(pg_temp.pushes(pg_temp.u635(5), 'Anunț nou: Important 635'), 0::bigint,
  'muting announce skips the push of an important Announcement');
select is(pg_temp.in_app(pg_temp.u635(5), 'Anunț nou: Important 635'), 1::bigint,
  'the important Announcement''s in-app row is there');
select ok(
  (select bool_and(critical) from notifications where title = 'Anunț nou: Critic 635')
  and not (select bool_or(critical) from notifications where title in ('Anunț nou: Normal 635', 'Anunț nou: Important 635')),
  'the fan-out marks only a critical Announcement''s Notification critical');
select is(pg_temp.pushes(pg_temp.u635(5), 'Anunț nou: Critic 635'), 1::bigint,
  'a critical Announcement still pushes to a Member who muted announce');

select * from finish();
rollback;
