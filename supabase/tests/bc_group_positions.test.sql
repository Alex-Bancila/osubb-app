-- Ruling R42 (2026-10-07): BC may hold either Group position, and a position brings
-- its notices. A BC member who is a Manager or Responsible of Group G gets G's Task,
-- Event and Announcement notices -- and those of every Group below G -- like any
-- position holder. A BC member who is only a membru de drept (or a plain member) of G
-- gets nothing through G (R32 still holds); the Moderator holds no position and gets
-- nothing through any Group; the actor is never told.
--
-- Mutation proofs (each run once against this suite, then reverted):
--   * private.group_notification_audience without its board_position_holders branch
--     (back to 20260929200000): tests 3, 11, 12, 14, 17 (the Event notices) fail;
--   * private.task_managers with `role.level < 6` (back to 20260929230000): tests
--     4-6 fail here, and 5-10 and 12 of task_managers_nearest_above;
--   * private.board_position_holders with `role.level >= 6` instead of `= 6` (the
--     Moderator's row counting): tests 1, 3, 16, 17, 21, 22 fail; without its
--     `group_role in (...)` filter (a plain-member BC counting): tests 1, 3, 11, 12,
--     14, 16-18, 20-22 fail;
--   * my_unread_announcements_count without its R42 branch: 23-24 fail; with
--     `>= 6` instead of `= 6`: 26 fails; without its `group_role` filter: 25 fails;
--   * fan_out_announcement / announcement_readers_impl taking the holders of the
--     audience Group instead of the Origin: 20 / 22 fail.
--
-- Personas (prefix 4242):
--   1 bc        activ    Manager of Parent R42
--   2 bc        activ    Responsible of Peer R42 (a root with no Manager)
--   3 bc        activ    no roster row: a membru de drept only
--   4 moderator activ    a Manager row on Parent R42 (the Moderator holds no position)
--   5 voluntar  activ    member of Parent R42 and of Child R42
--   6 voluntar  activ    member of Peer Child R42
--   7 bc        activ    plain member of Parent R42 (no position)
--   8 voluntar  inactiv  creator of every Task (never a live recipient)
--
-- Groups: Parent R42 > Child R42; Peer R42 > Peer Child R42.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.u42(n integer) returns uuid language sql immutable as $$
  select ('42420000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email)
select pg_temp.u42(n), 'pozitii.' || n || '.r42@test.local' from generate_series(1, 8) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u42(n), 'Pozitii R42 ' || n, 'pozitii.' || n || '.r42@test.local',
       (case n when 1 then 'bc' when 2 then 'bc' when 3 then 'bc' when 4 then 'moderator'
               when 7 then 'bc' else 'voluntar' end)::public.member_role,
       (case when n = 8 then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 8) n;

insert into public.groups(name, category, min_level) values ('Parent R42', 'department', 0);
insert into public.groups(name, category, min_level) values ('Peer R42', 'department', 0);
insert into public.groups(name, category, parent_id, min_level)
select 'Child R42', 'team', id, 0 from public.groups where name = 'Parent R42';
insert into public.groups(name, category, parent_id, min_level)
select 'Peer Child R42', 'team', id, 0 from public.groups where name = 'Peer R42';
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u42(roster.n), roster.role
  from (values ('Parent R42', 1, 'manager'), ('Parent R42', 4, 'manager'), ('Parent R42', 5, 'member'),
               ('Parent R42', 7, 'member'), ('Child R42', 5, 'member'),
               ('Peer R42', 2, 'responsible'), ('Peer Child R42', 6, 'member')) as roster(name, n, role)
  join public.groups as grp on grp.name = roster.name;

create temp table g42 as select name, id from public.groups where name like '% R42';
grant select on g42 to authenticated;
create function pg_temp.g42(p_name text) returns bigint language sql stable as $$
  select id from g42 where name = p_name
$$;
-- The personas among a set of members, as numbers.
create function pg_temp.who(p_members uuid[]) returns integer[] language sql immutable as $$
  select coalesce(array_agg(right(member::text, 12)::integer order by right(member::text, 12)::integer), '{}')
    from unnest(p_members) as member
   where member::text like '42420000-%'
$$;
create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select pg_temp.who(array(select member_id from public.notifications where title = p_title))
$$;

-- ==================== the BC position holders ====================

select is(
  pg_temp.who(array(select private.board_position_holders(pg_temp.g42('Child R42')))),
  array[1],
  'a BC Manager of the parent holds a position that reaches the Child Group -- never the Moderator''s row, the plain-member BC or a membru de drept');
select is(
  pg_temp.who(array(select private.board_position_holders(pg_temp.g42('Peer Child R42')))),
  array[2],
  'a BC Responsible''s position reaches the Groups below it too');
select is(
  pg_temp.who(array(select private.group_notification_audience(pg_temp.g42('Parent R42')))),
  array[1, 5],
  'the audience Notifications reach keeps the BC Manager and drops the plain-member BC and the Moderator despite their roster rows');

-- ==================== Tasks ====================

insert into public.tasks(title, description, deadline, group_id, audience, assignment_mode, status, created_by)
select 'Task ' || grp.name, 'x', '2027-05-01 09:00+00', grp.id, 'local', 'direct', 'todo', pg_temp.u42(8)
  from g42 as grp;
create function pg_temp.t42(p_group text) returns bigint language sql stable as $$
  select id from public.tasks where title = 'Task ' || p_group
$$;

select is(
  pg_temp.who(array(select private.task_managers(pg_temp.t42('Parent R42'), null))),
  array[1],
  'a BC Manager is a live Manager of the Task''s Group: notified, and the Moderator''s Manager row is not');
select is(
  pg_temp.who(array(select private.task_managers(pg_temp.t42('Child R42'), null))),
  array[1],
  'a Child Group''s Task with no Manager of its own notifies the BC Manager of the Group above');
select is(
  pg_temp.who(array(select private.task_managers(pg_temp.t42('Peer Child R42'), null))),
  array[2],
  'with no Manager on the path, a BC peer Responsible is notified');
select is(
  (select count(*) from private.task_managers(pg_temp.t42('Child R42'), pg_temp.u42(1))),
  0::bigint,
  'the BC Manager acting is told nothing, and still stops the walk -- nobody else is added');
select is(
  (select count(*)
     from unnest(array['Parent R42', 'Child R42', 'Peer R42', 'Peer Child R42']) as grp
    cross join lateral private.task_managers(pg_temp.t42(grp), null) as recipient
    where recipient in (pg_temp.u42(3), pg_temp.u42(4), pg_temp.u42(7))),
  0::bigint,
  'no Task notifies a membru de drept, the plain-member BC or the Moderator');

-- ==================== Events ====================

-- The Moderator creates them: an Event on Parent R42 and one on Child R42.
select pg_temp.test_login_leadership(pg_temp.u42(4));
select lives_ok($$select public.create_event('Sedinta Parent R42', 'sedinta', pg_temp.g42('Parent R42'),
  '2030-10-01 15:00+00', '2030-10-01 16:00+00', 'Sala 1', null, null)$$,
  'the Moderator creates an Event on the parent');
select lives_ok($$select public.create_event('Sedinta Child R42', 'sedinta', pg_temp.g42('Child R42'),
  '2030-10-02 15:00+00', '2030-10-02 16:00+00', 'Sala 2', null, null)$$,
  'the Moderator creates an Event on the Child Group');
reset role;
select is(pg_temp.notified('Eveniment nou: Sedinta Parent R42'), array[1, 5],
  'a new Event reaches the BC Manager of its Group, never a membru de drept, the plain-member BC or the Moderator (R39)');
select is(pg_temp.notified('Eveniment nou: Sedinta Child R42'), array[1, 5],
  'a new Event on a Child Group reaches the BC Manager of the Group above');

select pg_temp.test_login_leadership(pg_temp.u42(4));
select lives_ok($$select public.cancel_event((select id from public.events where title = 'Sedinta Child R42'), 'Amanat')$$,
  'the Moderator cancels the Child Group''s Event');
reset role;
select is(pg_temp.notified('Eveniment anulat: Sedinta Child R42'), array[1, 5],
  'the cancellation reaches the BC Manager of the Group above as well');

-- The BC Manager acts: no echo.
select pg_temp.test_login_leadership(pg_temp.u42(1));
select lives_ok($$select public.create_event('Atelier Child R42', 'activitate', pg_temp.g42('Child R42'),
  '2030-10-03 15:00+00', '2030-10-03 16:00+00', 'Sala 3', null, null)$$,
  'the BC Manager creates an Event on the Child Group');
reset role;
select is(pg_temp.notified('Eveniment nou: Atelier Child R42'), array[5],
  'the BC Manager who created it is not told of their own Event');

select is(
  pg_temp.who(array(select private.event_notification_recipients(
    (select id from public.events where title = 'Sedinta Parent R42')))),
  array[1, 5],
  'the Event recipient set is the same: the BC position holder in, the Moderator out');

-- ==================== Announcements ====================

-- Written server-side (no session), so created_by is the actor.
select pg_temp.test_clear_jwt();
insert into public.announcements(title, body, group_id, audience, created_by)
values ('Local Child R42', 'Body', pg_temp.g42('Child R42'), 'local', pg_temp.u42(4)),
       ('Org Parent R42', 'Body', pg_temp.g42('Parent R42'), 'org', pg_temp.u42(4)),
       ('Local Peer Child R42', 'Body', pg_temp.g42('Peer Child R42'), 'local', pg_temp.u42(4)),
       ('Own Child R42', 'Body', pg_temp.g42('Child R42'), 'local', pg_temp.u42(1));

select is(pg_temp.notified('Anunț nou: Local Child R42'), array[1, 5],
  'a Child Group''s Announcement reaches the BC Manager of the Group above, never the plain-member BC or the Moderator');
select is(pg_temp.notified('Anunț nou: Local Peer Child R42'), array[2, 6],
  'a BC Responsible gets the Announcements of the Groups below their position');
select is(pg_temp.notified('Anunț nou: Org Parent R42'), array[1, 5, 6],
  'an organization-wide Announcement of the parent reaches its BC Manager, never a BC without a position there or the Moderator');
select is(pg_temp.notified('Anunț nou: Own Child R42'), array[5],
  'the BC Manager who published it is not told of their own Announcement');

select pg_temp.test_login_leadership(pg_temp.u42(1));
select is(
  pg_temp.who(array(select member_id from public.announcement_readers(
    (select id from public.announcements where title = 'Org Parent R42')))),
  array[1, 5, 6],
  'the readers list names the same recipients, the BC Manager of the Origin included');
select is(
  public.my_unread_announcements_count(),
  (select count(*)::integer from public.announcements as announcement
    where announcement.group_id in (pg_temp.g42('Parent R42'), pg_temp.g42('Child R42'))
      and not exists (select 1 from public.announcement_reads as reads
                       where reads.announcement_id = announcement.id
                         and reads.member_id = pg_temp.u42(1))),
  'a BC Manager''s Anunțuri badge counts the unread Announcements whose Origin their position reaches');
select ok(public.my_unread_announcements_count() >= 2,
  'and that is more than nothing: the parent''s and the Child Group''s');
reset role;

select pg_temp.test_login_leadership(pg_temp.u42(7));
select is(public.my_unread_announcements_count(), 0,
  'a BC member who is a plain member of the Group counts none of them');
reset role;
select pg_temp.test_login_leadership(pg_temp.u42(4));
select is(public.my_unread_announcements_count(), 0,
  'the Moderator counts none, whatever roster row they have');
reset role;

select * from finish();
rollback;
