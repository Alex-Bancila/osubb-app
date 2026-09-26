-- #756 (ruling R25): Private Groups. A Private Group, every Group below it and
-- their Tasks and Events are visible only to their members, the Group Managers
-- and Responsibles on its path, and BC/Moderator (private.can_see_group); it
-- accepts no Applications, its Tasks carry only the local Audience, and entry
-- is by Appointment.
--
-- Fixture: Root #756 (public) -> Private #756 (created private by BC) ->
-- Child #756 (created by Private's Manager, inherits privacy); Other #756, an
-- unrelated public Group; Auto parent #756, a Private Group whose Child has
-- Automatic Membership at level 3; Open #756, a public control Group; and
-- Cascade #756, the subtree the structural setting cascades over.
--
--   n  role         roster
--   1  bc           none
--   2  moderator    none
--   3  bce          none (level 5: reads every Task and roster, but not these)
--   4  vot          member of Private
--   5  vot          none (the level-3 outsider)
--   6  vot          manager of Other (an unrelated Group Manager)
--   7  vot          manager of Root (the ancestor Manager)
--   8  vot          member of Child only
--   9  vot          responsible of Private
--  10  vot          none, until appointed to Private
--  11  vot          manager of Private (appointed with it)
--  12  voluntar     none (level 1: below Auto #756's Minimum Level)
--
-- Mutation guards (each revert turns the named assertion red):
--   groups_read without can_see_group         -> "groups_read: the level-3 outsider ..."
--   can_read_task without can_see_group       -> "tasks_read: the level-3 outsider ..." and "... BCE ..."
--   can_read_event without can_see_group      -> "events_read: the level-3 outsider ..." and the fan-out one
--   group_members_read without can_see_group  -> "group_members_read: a BCE ..."
--   the cascade without its repeated pass    -> "race: the repeated cascade pass ..."
--   leadership_member_tasks without can_see_group (#759)
--                                             -> "leadership_member_tasks: a BCE ..."
--   campaigns_read without can_see_group (#759)
--                                             -> "campaigns_read: the level-3 outsider ..." and "... BCE ..."
--   group_coordination_impl without can_see_group (#589)
--                                             -> "group_coordination: the level-3 outsider ..." and "... BCE ..."
-- my_groups() needs no call of its own: its rows are the caller's own
-- Group Roles, each of which can_see_group admits by construction, and the
-- wrapper joins public.groups under groups_read. Its assertions below pin
-- the behaviour; the groups_read guard is the one that can make it leak.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(85);

create function pg_temp.u756(n integer) returns uuid language sql immutable as $$
  select ('75600000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u756(n), 'private.' || n || '.756@test.local' from generate_series(1, 12) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u756(n), 'Private #756 ' || n, 'private.' || n || '.756@test.local',
       (case n when 1 then 'bc' when 2 then 'moderator' when 3 then 'bce'
               when 12 then 'voluntar' else 'vot' end)::public.member_role,
       'activ'
  from generate_series(1, 12) n;

-- Native public Groups (OD9 fixture exception); the private ones go through the commands.
insert into public.groups (name, category) values
  ('Root #756', 'department'), ('Other #756', 'department'), ('Open #756', 'department');
insert into public.group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u756(row_.n), row_.group_role
  from (values ('Root #756', 7, 'manager'), ('Other #756', 6, 'manager')) as row_ (name, n, group_role)
  join public.groups as grp on grp.name = row_.name;

create function pg_temp.g756(p_name text) returns bigint language sql stable security definer as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.g756(text) to authenticated;
create function pg_temp.e756(p_title text) returns bigint language sql stable security definer as $$
  select id from public.events where title = p_title
$$;
grant execute on function pg_temp.e756(text) to authenticated;

-- What the current caller can see, as one comparable string.
create function pg_temp.visible_groups() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '')
    from public.groups where name in ('Private #756', 'Child #756')
$$;
create function pg_temp.visible_my_groups() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '')
    from public.my_groups() where name in ('Private #756', 'Child #756')
$$;
create function pg_temp.visible_tasks() returns bigint language sql as $$
  select count(*) from public.tasks where title like '% in private #756'
$$;
create function pg_temp.visible_events() returns bigint language sql as $$
  select count(*) from public.events where title like '% in private #756'
$$;
grant execute on function pg_temp.visible_groups() to authenticated;
grant execute on function pg_temp.visible_my_groups() to authenticated;
grant execute on function pg_temp.visible_tasks() to authenticated;
grant execute on function pg_temp.visible_events() to authenticated;

-- ==================== 1 · creation and inheritance ====================

select has_column('public', 'groups', 'is_private', 'groups.is_private exists');
select col_default_is('public', 'groups', 'is_private', 'false', 'a Group is public unless made private');

select pg_temp.test_login_leadership(pg_temp.u756(1));
select lives_ok(
  format($$select public.create_group('Private #756', 'team', %s, null, %L, null, null, true)$$,
         pg_temp.g756('Root #756'), pg_temp.u756(11)),
  'create_group: BC creates a Private Group under a public parent');
select pg_temp.test_login_leadership(pg_temp.u756(11));
select lives_ok(
  format($$select public.create_group('Child #756', 'team', %s)$$, pg_temp.g756('Private #756')),
  'create_group: the Private Group''s Manager creates a Child Group without asking for privacy');
reset role;
select is(
  (select array_agg(is_private order by name) from public.groups
    where name in ('Private #756', 'Child #756', 'Root #756')),
  array[true, true, false],
  'a Child Group inherits privacy at creation; the public parent stays public');

select pg_temp.test_login_leadership(pg_temp.u756(7));
select throws_ok(
  format($$select public.create_group('Secret kid #756', 'team', %s, null, null, null, null, true)$$,
         pg_temp.g756('Root #756')),
  '42501', 'group_manage_forbidden',
  'create_group: a parent''s Manager below level 6 cannot start a private Child Group under a public parent');
reset role;

-- The roster, through the Appointment core the commands use.
select private.appoint_group_member(pg_temp.g756('Private #756'), pg_temp.u756(4), pg_temp.u756(1));
select private.appoint_group_member(pg_temp.g756('Private #756'), pg_temp.u756(9), pg_temp.u756(1), 'responsible', 'Responsabil');
select private.appoint_group_member(pg_temp.g756('Child #756'), pg_temp.u756(8), pg_temp.u756(1));

-- Work fixtures. The org-Audience Task stands for one created before the Group
-- turned private; create_task could not write it today.
insert into public.tasks (title, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Org opportunity in private #756', '2027-03-01 09:00+00', pg_temp.g756('Private #756'), 'org', 'public', 'todo',
   '2027-01-01 00:00+00', pg_temp.u756(11)),
  ('Local opportunity in private #756', '2027-03-01 09:00+00', pg_temp.g756('Private #756'), 'local', 'public', 'todo',
   '2027-01-01 00:00+00', pg_temp.u756(11)),
  ('Child opportunity in private #756', '2027-03-01 09:00+00', pg_temp.g756('Child #756'), 'org', 'public', 'todo',
   '2027-01-01 00:00+00', pg_temp.u756(11)),
  ('Control opportunity #756', '2027-03-01 09:00+00', pg_temp.g756('Open #756'), 'org', 'public', 'todo',
   '2027-01-01 00:00+00', pg_temp.u756(1));
insert into public.events (title, type, group_id, starts_at, created_by, min_level) values
  ('Meeting in private #756', 'sedinta', pg_temp.g756('Private #756'), '2027-02-01 12:00+00', pg_temp.u756(11), 0),
  ('Child meeting in private #756', 'sedinta', pg_temp.g756('Child #756'), '2027-02-01 12:00+00', pg_temp.u756(11), 0),
  ('Control meeting #756', 'sedinta', pg_temp.g756('Open #756'), '2027-02-01 12:00+00', pg_temp.u756(1), 0);
-- An outsider who said "Vin" before the Group turned private.
insert into public.event_attendance (event_id, member_id, status)
select id, pg_temp.u756(5), 'going' from public.events where title = 'Meeting in private #756';

-- ==================== 2 · groups_read, my_groups(), group_members_read ====================

select pg_temp.test_login_leadership(pg_temp.u756(5));
select is(pg_temp.visible_groups(), '',
  'groups_read: the level-3 outsider sees neither the Private Group nor its Child');
select is((select count(*) from public.groups where name = 'Root #756'), 1::bigint,
  'groups_read: the outsider still sees the public parent (the gate hides only the private subtree)');
select is(pg_temp.visible_my_groups(), '', 'my_groups(): nothing private for the outsider');
select pg_temp.test_login_leadership(pg_temp.u756(3));
select is(pg_temp.visible_groups(), '',
  'groups_read: a BCE without a Group Role sees no Private Group (level 5 is below the gate)');
select is((select count(*) from public.group_members where group_id = pg_temp.g756('Private #756')), 0::bigint,
  'group_members_read: a BCE reads every roster but not a Private Group''s');
select pg_temp.test_login_leadership(pg_temp.u756(6));
select is(pg_temp.visible_groups(), '',
  'groups_read: the Manager of an unrelated Group sees no Private Group');
select pg_temp.test_login_leadership(pg_temp.u756(4));
select is(pg_temp.visible_groups(), 'Private #756',
  'groups_read: a member sees the Private Group, but not a private Child Group they do not belong to');
select is(pg_temp.visible_my_groups(), 'Private #756', 'my_groups(): the member''s Private Group is listed');
select pg_temp.test_login_leadership(pg_temp.u756(8));
select is(pg_temp.visible_groups(), 'Child #756,Private #756',
  'groups_read: a member of the Child Group also sees the Private Group above it');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select is(pg_temp.visible_groups(), 'Child #756,Private #756',
  'groups_read: the ancestor Manager sees the whole private subtree');
select is(pg_temp.visible_my_groups(), 'Child #756,Private #756',
  'my_groups(): the ancestor Manager''s inherited position lists the whole subtree');
select pg_temp.test_login_leadership(pg_temp.u756(9));
select is(pg_temp.visible_groups(), 'Child #756,Private #756',
  'groups_read: the Private Group''s Responsible sees it and the Group below it');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(pg_temp.visible_groups(), 'Child #756,Private #756', 'groups_read: BC sees every Private Group');
select is((select count(*) from public.group_members where group_id = pg_temp.g756('Private #756')), 3::bigint,
  'group_members_read: BC reads the Private Group''s roster');
select pg_temp.test_login_leadership(pg_temp.u756(2));
select is(pg_temp.visible_groups(), 'Child #756,Private #756', 'groups_read: the Moderator sees every Private Group');

-- ==================== 3 · tasks_read ====================

select pg_temp.test_login_leadership(pg_temp.u756(5));
select is(pg_temp.visible_tasks(), 0::bigint,
  'tasks_read: the level-3 outsider sees none of the Private Group''s Opportunities, org-Audience included (no greyed band)');
select is((select count(*) from public.tasks where title = 'Control opportunity #756'), 1::bigint,
  'tasks_read: the same outsider still sees a public Group''s open Opportunity');
select pg_temp.test_login_leadership(pg_temp.u756(3));
select is(pg_temp.visible_tasks(), 0::bigint,
  'tasks_read: a BCE (a global Task reader) sees no Private Group''s Task');
select pg_temp.test_login_leadership(pg_temp.u756(6));
select is(pg_temp.visible_tasks(), 0::bigint, 'tasks_read: nor does an unrelated Group''s Manager');
select pg_temp.test_login_leadership(pg_temp.u756(4));
select is(pg_temp.visible_tasks(), 2::bigint,
  'tasks_read: a member sees the Private Group''s Opportunities but not those of a private Child they are not in');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select is(pg_temp.visible_tasks(), 3::bigint, 'tasks_read: the ancestor Manager sees every Task of the subtree');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(pg_temp.visible_tasks(), 3::bigint, 'tasks_read: BC sees every Task of the subtree');

-- ==================== 4 · events_read and the Event fan-out ====================

select pg_temp.test_login_leadership(pg_temp.u756(5));
select is(pg_temp.visible_events(), 0::bigint,
  'events_read: the level-3 outsider sees none of the Private Group''s Events');
select is((select count(*) from public.events where title = 'Control meeting #756'), 1::bigint,
  'events_read: the same outsider still sees a public Group''s Event');
select pg_temp.test_login_leadership(pg_temp.u756(3));
select is(pg_temp.visible_events(), 0::bigint, 'events_read: a BCE sees no Private Group''s Event');
select pg_temp.test_login_leadership(pg_temp.u756(4));
select is(pg_temp.visible_events(), 1::bigint, 'events_read: a member sees the Private Group''s own Event');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select is(pg_temp.visible_events(), 2::bigint, 'events_read: the ancestor Manager sees every Event of the subtree');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(pg_temp.visible_events(), 2::bigint, 'events_read: BC sees every Event of the subtree');
reset role;
select ok(
  not exists (select 1 from private.event_notification_recipients(
                (select id from public.events where title = 'Meeting in private #756')) as r
               where r = pg_temp.u756(5))
  and exists (select 1 from private.event_notification_recipients(
                (select id from public.events where title = 'Meeting in private #756')) as r
               where r = pg_temp.u756(4)),
  'Event fan-out: a going outsider is dropped from a Private Group''s Event recipients; the member stays');
select pg_temp.test_login_leadership(pg_temp.u756(6));
select throws_ok(
  format($$select public.cancel_event(%s, 'nu')$$,
         pg_temp.e756('Meeting in private #756')),
  'PT404', 'event_not_found',
  'cancel_event: a Private Group''s Event is missing, not forbidden, for an outsider');
select throws_ok(
  format($$select public.update_event(%s, 'Meeting in private #756', 'sedinta', %s,
            '2027-02-01 12:00+00', null, null, null, null, 0, null)$$,
         pg_temp.e756('Meeting in private #756'), pg_temp.g756('Private #756')),
  'PT404', 'event_not_found',
  'update_event: and missing for update_event too -- the two commands agree');

-- Moving an Event into a Private Group: the old Group's Audience is told only
-- if they can read the Event where it now lives.
reset role;
insert into public.events (title, type, group_id, starts_at, created_by, min_level)
values ('Moving meeting #756', 'sedinta', pg_temp.g756('Other #756'), '2027-02-02 12:00+00', pg_temp.u756(1), 0);
select pg_temp.test_login_leadership(pg_temp.u756(1));
select lives_ok(
  format($$select public.update_event(%s, 'Moving meeting #756', 'sedinta', %s,
            '2027-02-02 12:00+00', null, null, null, null, 0, null)$$,
         pg_temp.e756('Moving meeting #756'), pg_temp.g756('Private #756')),
  'update_event: BC moves an Event from a public Group into the Private Group');
reset role;
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where title = 'Eveniment actualizat: Moving meeting #756' and body = 'Noul grup: Private #756'
      and member_id in (pg_temp.u756(4), pg_temp.u756(6))),
  array[pg_temp.u756(4)],
  'update_event: the move reaches the Private Group''s member, not the old Group''s outsider');

-- ==================== 5 · the local-only Audience ====================

select pg_temp.test_login_leadership(pg_temp.u756(11));
select throws_ok(
  format($$select public.create_task(p_title => 'Org task #756', p_description => null,
            p_deadline => '2027-04-01 09:00+00', p_audience => 'org', p_assignment_mode => 'public',
            p_executor_id => null, p_campaign_id => null, p_parent_task_id => null, p_kind => 'task',
            p_group_id => %s, p_link_label => null, p_link_url => null)$$, pg_temp.g756('Private #756')),
  'PT400', 'private_group_local_only',
  'create_task: the organization-wide Audience is refused on a Private Group');
select throws_ok(
  format($$select public.create_task(p_title => 'Org child task #756', p_description => null,
            p_deadline => '2027-04-01 09:00+00', p_audience => 'org', p_assignment_mode => 'public',
            p_executor_id => null, p_campaign_id => null, p_parent_task_id => null, p_kind => 'task',
            p_group_id => %s, p_link_label => null, p_link_url => null)$$, pg_temp.g756('Child #756')),
  'PT400', 'private_group_local_only',
  'create_task: and on a Child Group that inherited privacy');
select lives_ok(
  format($$select public.create_task(p_title => 'Local task #756', p_description => null,
            p_deadline => '2027-04-01 09:00+00', p_audience => 'local', p_assignment_mode => 'public',
            p_executor_id => null, p_campaign_id => null, p_parent_task_id => null, p_kind => 'task',
            p_group_id => %s, p_link_label => null, p_link_url => null)$$, pg_temp.g756('Private #756')),
  'create_task: the local Audience is accepted on a Private Group');
select throws_ok(
  format($$select public.update_task(%s, %s, 'Local opportunity in private #756', null, '2027-03-01 09:00+00',
            null, 'public', 'org', null, null, true)$$,
         (select id from public.tasks where title = 'Local opportunity in private #756'), pg_temp.g756('Private #756')),
  'PT400', 'private_group_local_only',
  'update_task: a Private Group''s Task cannot be widened to the organization-wide Audience');
select throws_ok(
  format($$select * from public.preview_task_update(%s, %s, 'Local opportunity in private #756', null,
            '2027-03-01 09:00+00', null, 'public', 'org', null, null)$$,
         (select id from public.tasks where title = 'Local opportunity in private #756'), pg_temp.g756('Private #756')),
  'PT400', 'private_group_local_only',
  'preview_task_update: the preview refuses it the same way');
select is(
  (select audience from public.tasks where title = 'Local opportunity in private #756'), 'local',
  'the Private Group''s existing Task keeps the local Audience');
select is(
  (select clone.audience from public.duplicate_task(
     (select id from public.tasks where title = 'Org opportunity in private #756'), '2027-05-01 09:00+00') as clone),
  'local',
  'duplicate_task: a copy of an older org-Audience Task made inside a Private Group is local');
-- #794: convert_task_mode never judged R25 until now.
select throws_ok(
  format($$select public.convert_task_mode(%s, 'public', 'org')$$,
         (select id from public.tasks where title = 'Local task #756')),
  'PT400', 'private_group_local_only',
  'convert_task_mode: a Private Group''s Task cannot be converted to the organization-wide Audience (#794)');
select is(
  (select audience from public.tasks where title = 'Local task #756'), 'local',
  'convert_task_mode: the refused conversion left the Task local');

-- ==================== 6 · Applications ====================

select pg_temp.test_login_leadership(pg_temp.u756(8));
select throws_ok(
  format($$select public.apply_to_group(%s, null)$$, pg_temp.g756('Private #756')),
  'PT400', 'group_private',
  'apply_to_group: a Member who can see the Private Group is refused -- entry is by Appointment');
select pg_temp.test_login_leadership(pg_temp.u756(5));
select throws_ok(
  format($$select public.apply_to_group(%s, null)$$, pg_temp.g756('Private #756')),
  'PT404', 'group_not_found',
  'apply_to_group: to an outsider a Private Group is missing, as in groups_read');
select pg_temp.test_login_leadership(pg_temp.u756(11));
select throws_ok(
  format($$select public.update_group(%s, 'Private #756', null, true, 3, false, 0, null, null, false)$$,
         pg_temp.g756('Private #756')),
  'PT400', 'group_private',
  'update_group: Applications cannot be turned on for a Private Group');

-- ==================== 7 · Appointment ====================

select lives_ok(
  format($$select public.add_group_member(%s, %L)$$, pg_temp.g756('Private #756'), pg_temp.u756(10)),
  'add_group_member: the Private Group''s Manager appoints a Member, unchanged');
reset role;
select is(
  (select count(*) from public.notifications
    where member_id = pg_temp.u756(10) and title = 'Ai fost adăugat în Private #756'),
  1::bigint,
  'the roster notification is the invite');
select pg_temp.test_login_leadership(pg_temp.u756(10));
select is(pg_temp.visible_groups(), 'Private #756', 'the appointed Member sees the Private Group from then on');
select is(pg_temp.visible_my_groups(), 'Private #756', 'my_groups(): and it is listed as theirs');

-- ==================== 8 · Announcements and the Member Card ====================

reset role;
insert into public.announcements (title, body, group_id, audience, created_by)
values ('Org news in private #756', 'Doar pentru noi.', pg_temp.g756('Private #756'), 'org', pg_temp.u756(11));
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where title = 'Anunț nou: Org news in private #756'
      and member_id in (pg_temp.u756(4), pg_temp.u756(5))),
  array[pg_temp.u756(4)],
  'announcement fan-out: an org-wide Announcement of a Private Group reaches its member, not the outsider');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(
  (select array_agg(reader.member_id order by reader.member_id)
     from public.announcement_readers(
            (select id from public.announcements where title = 'Org news in private #756')) as reader
    where reader.member_id in (pg_temp.u756(4), pg_temp.u756(5))),
  array[pg_temp.u756(4)],
  'announcement_readers: the readers list names the member, not the outsider');
select pg_temp.test_login_leadership(pg_temp.u756(5));
select is((select count(*) from public.announcements where title = 'Org news in private #756'), 0::bigint,
  'announcements_read: the outsider cannot read it');
select is(
  (select jsonb_path_query_array(card.memberships, '$[*].name') from public.member_card(pg_temp.u756(4)) as card),
  '[]'::jsonb,
  'member_card: the outsider is not told the Member belongs to a Private Group');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select is(
  (select jsonb_path_query_array(card.memberships, '$[*].name') from public.member_card(pg_temp.u756(4)) as card),
  '["Private #756"]'::jsonb,
  'member_card: the ancestor Manager is');
select pg_temp.test_login_leadership(pg_temp.u756(5));
select is((select count(*) from public.group_coordination(pg_temp.g756('Private #756'))), 0::bigint,
  'group_coordination: the level-3 outsider is not told who coordinates a Private Group');
select pg_temp.test_login_leadership(pg_temp.u756(3));
select is((select count(*) from public.group_coordination(pg_temp.g756('Private #756'))), 0::bigint,
  'group_coordination: nor is a BCE without a Group Role (level 5 is below the gate)');
select pg_temp.test_login_leadership(pg_temp.u756(4));
select is(
  (select array_agg(coordinator.member_id order by coordinator.member_id)
     from public.group_coordination(pg_temp.g756('Private #756')) as coordinator),
  array[pg_temp.u756(9), pg_temp.u756(11)],
  'group_coordination: a member reads the Private Group''s Manager and Responsible');

-- ==================== 9 · Automatic Membership inside a private subtree ====================

-- A Private Group at Minimum Level 0 whose Child Group has Automatic
-- Membership at level 3: the level-3 outsider belongs to the Child, the
-- level-1 Member belongs to neither -- but would pass groups_read's own
-- Minimum-Level limb on the parent without the gate.
reset role;
insert into public.groups (name, category, is_private) values ('Auto parent #756', 'team', true);
insert into public.groups (name, category, parent_id, min_level, automatic_membership, is_private)
select 'Auto kid #756', 'team', id, 3, true, true from public.groups where name = 'Auto parent #756';
select pg_temp.test_login_leadership(pg_temp.u756(5));
select is((select count(*) from public.groups where name = 'Auto parent #756'), 1::bigint,
  'can_see_group: an Automatic Member of a Group below a Private Group sees it');
select pg_temp.test_login_leadership(pg_temp.u756(12));
select is((select count(*) from public.groups where name = 'Auto parent #756'), 0::bigint,
  'can_see_group: a Member below that Child''s Minimum Level does not, though the parent admits level 0');

-- ==================== 10 · the structural setting and its cascade ====================

reset role;
insert into public.groups (name, category) values ('Cascade #756', 'department');
insert into public.groups (name, category, parent_id, accepts_applications, application_level)
select 'Cascade kid #756', 'team', id, true, 0 from public.groups where name = 'Cascade #756';
insert into public.groups (name, category, parent_id)
select 'Cascade grandkid #756', 'team', id from public.groups where name = 'Cascade kid #756';
-- An Application filed while the Child Group still accepted them.
select pg_temp.test_login_leadership(pg_temp.u756(5));
select public.apply_to_group(pg_temp.g756('Cascade kid #756'), null);

select pg_temp.test_login_leadership(pg_temp.u756(1));
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, false, null)$$,
         pg_temp.g756('Cascade #756')),
  'PT400', 'invalid_group_privacy',
  'update_group_structure: a null privacy is refused, never read as public');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, true, true)$$,
         pg_temp.g756('Cascade #756')),
  'PT400', 'private_not_allowed_for_organization',
  'update_group_structure: the Organization Group cannot be private');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, false, true)$$,
         pg_temp.g756('Cascade #756')),
  '42501', 'group_manage_forbidden',
  'update_group_structure: privacy is BC''s and the Moderator''s, not a Group Manager''s');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select lives_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, false, true)$$,
         pg_temp.g756('Cascade #756')),
  'update_group_structure: BC makes a Group private');
select is(
  (select array_agg(is_private::text || '/' || accepts_applications::text order by name) from public.groups
    where name like 'Cascade%#756'),
  array['true/false', 'true/false', 'true/false'],
  'the whole subtree turns private in the same command, with its Applications switched off');
reset role;
select is(
  (select application.status || '/' || (application.decided_by = pg_temp.u756(1))::text
     from public.group_applications as application
    where application.group_id = pg_temp.g756('Cascade kid #756') and application.member_id = pg_temp.u756(5)),
  'withdrawn/true',
  'and a pending Application in the subtree is withdrawn with BC as decider -- it is not grandfathered');
select pg_temp.test_login_leadership(pg_temp.u756(5));
select is((select count(*) from public.groups where name like 'Cascade%#756'), 0::bigint,
  'and an outsider stops seeing all three Groups in the same transaction');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select throws_ok(
  format($$select public.update_group_structure(%s, 'team', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g756('Cascade kid #756')),
  'PT400', 'private_parent',
  'update_group_structure: a Child Group cannot be made public under a private parent');
select lives_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g756('Cascade #756')),
  'update_group_structure: BC makes the parent public again');
reset role;
select is(
  (select array_agg(is_private order by name) from public.groups where name like 'Cascade%#756'),
  array[false, true, true],
  'turning a parent public leaves its Child Groups as they are');

-- ==================== 11 · the leadership drill-down and Campaigns (#759) ====================
-- Two read paths #756 left open: the BCE+ drill-down is a definer function
-- behind a level threshold, and campaigns_read admitted every Member. Both
-- now ask can_see_group of the owning Group.

reset role;
insert into public.tasks (title, deadline, group_id, audience, assignment_mode, status, created_by) values
  ('Drill private #759', '2027-03-01 09:00+00', pg_temp.g756('Private #756'), 'local', 'direct', 'todo', pg_temp.u756(11)),
  ('Drill public #759', '2027-03-01 09:00+00', pg_temp.g756('Open #756'), 'local', 'direct', 'todo', pg_temp.u756(1));
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, pg_temp.u756(4), pg_temp.u756(1), now()
  from public.tasks where title like 'Drill % #759';
insert into public.campaigns (group_id, name, created_by) values
  (pg_temp.g756('Private #756'), 'Campaign private #759', pg_temp.u756(1)),
  (pg_temp.g756('Child #756'), 'Campaign child #759', pg_temp.u756(1)),
  (pg_temp.g756('Open #756'), 'Campaign open #759', pg_temp.u756(1));

create function pg_temp.drill_759(p_member uuid) returns text language sql as $$
  select coalesce(string_agg(title, ',' order by title), '')
    from public.leadership_member_tasks(p_member) where title like 'Drill % #759'
$$;
create function pg_temp.visible_campaigns_759() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '')
    from public.campaigns where name like 'Campaign % #759'
$$;
grant execute on function pg_temp.drill_759(uuid) to authenticated;
grant execute on function pg_temp.visible_campaigns_759() to authenticated;

select pg_temp.test_login_leadership(pg_temp.u756(3));
select is(pg_temp.drill_759(pg_temp.u756(4)), 'Drill public #759',
  'leadership_member_tasks: a BCE drilling into a Member does not see their Assignment in a Private Group');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(pg_temp.drill_759(pg_temp.u756(4)), 'Drill private #759,Drill public #759',
  'leadership_member_tasks: BC sees every Assignment, the Private Group''s included');

select pg_temp.test_login_leadership(pg_temp.u756(5));
select is(pg_temp.visible_campaigns_759(), 'Campaign open #759',
  'campaigns_read: the level-3 outsider reads none of a Private Group''s Campaigns');
select pg_temp.test_login_leadership(pg_temp.u756(3));
select is(pg_temp.visible_campaigns_759(), 'Campaign open #759',
  'campaigns_read: nor does a BCE without a Group Role in it');
select pg_temp.test_login_leadership(pg_temp.u756(4));
select is(pg_temp.visible_campaigns_759(), 'Campaign open #759,Campaign private #759',
  'campaigns_read: a member reads the Private Group''s Campaign, but not a private Child''s they are not in');
select pg_temp.test_login_leadership(pg_temp.u756(7));
select is(pg_temp.visible_campaigns_759(), 'Campaign child #759,Campaign open #759,Campaign private #759',
  'campaigns_read: the Manager on the path reads every Campaign of the subtree');
select pg_temp.test_login_leadership(pg_temp.u756(1));
select is(pg_temp.visible_campaigns_759(), 'Campaign child #759,Campaign open #759,Campaign private #759',
  'campaigns_read: BC reads every Campaign');
select pg_temp.test_login_leadership(pg_temp.u756(12));
select is(pg_temp.visible_campaigns_759(), 'Campaign open #759',
  'campaigns_read: the membership gate still admits a level-1 Member to a public Group''s Campaign');
reset role;

-- ==================== 12 · a Child Group created during the cascade ====================
-- create_group locks only its parent. Session A creates a Child Group under a
-- descendant and holds that descendant; session B turns the root private and
-- its cascade waits on the same row. A commits a public Child Group that B's
-- first cascade pass cannot see; the repeated pass must still reach it.
-- Committed fixtures (a second session must see them), torn down at both ends.

select extensions.dblink_connect('races_756_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('races_756_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('races_756_setup', $setup$
  drop function if exists public.test_756_create();
  drop function if exists public.test_756_privatize();
  delete from public.groups where name like '%#756 race%';
  delete from auth.users where id = '75610000-0000-0000-0000-000000000090';
  insert into auth.users(id, email) values
    ('75610000-0000-0000-0000-000000000090', 'bc.race.756@test.local');
  insert into public.profiles(id, full_name, email, role, status) values
    ('75610000-0000-0000-0000-000000000090', 'Race BC #756', 'bc.race.756@test.local', 'bc', 'activ');
  insert into public.groups(name, category, created_by) values
    ('Root #756 race', 'department', '75610000-0000-0000-0000-000000000090');
  insert into public.groups(name, category, parent_id, created_by)
  select 'Kid #756 race', 'team', id, '75610000-0000-0000-0000-000000000090'
    from public.groups where name = 'Root #756 race';

  create function public.test_756_create() returns text
  language sql as $fn$
    select (public.create_group('Grandkid #756 race', 'team',
      (select id from public.groups where name = 'Kid #756 race'))).is_private::text;
  $fn$;

  create function public.test_756_privatize() returns text
  language sql as $fn$
    select (public.update_group_structure(
      (select id from public.groups where name = 'Root #756 race'),
      'department', false, true, false, 0, null, null, false, true)).is_private::text;
  $fn$;

  revoke execute on function public.test_756_create(), public.test_756_privatize()
    from public, anon, authenticated, service_role;
  grant execute on function public.test_756_create(), public.test_756_privatize() to authenticated;
$setup$);

select pg_temp.test_login('75610000-0000-0000-0000-000000000090',
  '{"member_role":"bc","member_level":6}');
reset role;
create temp table race_756 as select * from pg_temp.test_race(
  'select public.test_756_create()', 'select public.test_756_privatize()');

select is((select result_a || '|' || result_b || '|' || b_waited from race_756),
  'false|true|true',
  'race: the Child Group is created public under a still-public parent, and the cascade waits on that parent');
select is((select array_agg(is_private order by name) from public.groups where name like '%#756 race'),
  array[true, true, true],
  'race: the repeated cascade pass reaches the Child Group committed underneath it -- no public Group is left in the private subtree');

select extensions.dblink_exec('races_756_setup', $teardown$
  drop function if exists public.test_756_create();
  drop function if exists public.test_756_privatize();
  delete from public.groups where name like '%#756 race%';
  delete from auth.users where id = '75610000-0000-0000-0000-000000000090';
$teardown$);
select extensions.dblink_disconnect('races_756_setup');

select * from finish();
rollback;
