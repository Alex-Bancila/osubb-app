-- Cerere de aprobare (spec docs/superpowers/specs/2026-10-11-org-wide-approval-design.md):
-- an Announcement or Event on the Organization Group by a writer below BC waits
-- for a BC member or the Moderator, who approve it from its own form or reject
-- it with a reason; BC and the Moderator publish OSUBB-wide at once. Personas
-- (prefix 4700): 1 BCE, Manager of Dept A (holds a Group Role, so may post
-- OSUBB-wide); 2 BC; 3 Moderator; 4 Voluntar, member of Dept A; 5 Voluntar on
-- no roster.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(32);

create function pg_temp.u47(n integer) returns uuid language sql immutable as $$
  select ('47000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u47(integer) to authenticated, anon;
insert into auth.users (id, email)
select pg_temp.u47(n), 'm47.' || n || '@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u47(n), 'Membru 47 ' || n, 'm47.' || n || '@test.local',
       (case n when 1 then 'bce' when 2 then 'bc' when 3 then 'moderator' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into public.groups (name, category, min_level) values ('Dept A #4700', 'department', 0);
insert into public.group_members (group_id, member_id, group_role)
select g.id, pg_temp.u47(r.n), r.role
  from (values (1, 'manager'), (4, 'member')) as r (n, role)
  join public.groups as g on g.name = 'Dept A #4700';
create temp table fx47 as
select (select id from public.groups where is_organization) as org,
       (select id from public.groups where name = 'Dept A #4700') as dept;
grant select on fx47 to authenticated;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
create function pg_temp.ev(p_title text) returns public.events language sql stable security definer set search_path = '' as $$
  select * from public.events where title = p_title
$$;
-- The Members told under one title, as persona numbers.
create function pg_temp.told(p_title text) returns setof integer language sql stable security definer set search_path = '' as $$
  select right(member_id::text, 12)::integer from public.notifications
   where title = p_title and member_id::text like '47000000-%' order by 1
$$;

-- ==================== 1. the stamp ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann pending #4700', 'x', org, 'org' from fx47;
insert into announcements (title, body, group_id, audience) select 'Ann local #4700', 'x', dept, 'local' from fx47;
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending',
  'an OSUBB-wide Announcement by a BCE waits for approval');
select is((pg_temp.ann('Ann local #4700')).approval_status, 'approved',
  'a local Group Announcement by the same author publishes at once');
select is((select count(*) from pg_temp.told('Anunț nou: Ann pending #4700'))::int, 0,
  'nobody is told of a pending Announcement');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ann pending #4700')$$, $$values (2), (3)$$,
  'BC and the Moderator get one request each');
select pg_temp.test_login_leadership(pg_temp.u47(2));
insert into announcements (title, body, group_id, audience) select 'Ann by BC #4700', 'x', org, 'org' from fx47;
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'BC publishes OSUBB-wide at once');
select ok(4 in (select * from pg_temp.told('Anunț nou: Ann by BC #4700')), 'and its fan-out ran');

-- ==================== 2. who sees a pending row ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 0::bigint,
  'a third Member cannot read a pending Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
-- The badge is an invoker read: for anyone else the policy already hides the
-- row; for the author it is visible, and still never counts as unread.
select is(public.my_unread_announcements_count('announcement'),
  (select count(*)::int from announcements as a
    where a.kind = 'announcement' and a.approval_status = 'approved'
      and (a.priority = 'critical' or a.audience = 'org' or not private.is_group_muted(a.group_id))
      and not exists (select 1 from announcement_reads as r where r.announcement_id = a.id and r.member_id = pg_temp.u47(1))),
  'the author''s own pending Announcement never counts as unread');
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint,
  'the author reads their own pending Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(3));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'the Moderator reads it too');
reset role;

-- ==================== 3. re-entering review ====================
select pg_temp.test_login_leadership(pg_temp.u47(2));
update announcements set body = 'edited by BC' where title = 'Ann by BC #4700';
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'a BC edit never changes the status');
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann approved later #4700', 'x', org, 'org' from fx47;
reset role;
-- As the owner, standing in for the approve command (Task 2): the stamp honours
-- the decision flag.
select set_config('osubb.deciding_approval', 'on', true);
update announcements set approval_status = 'approved', approval_decided_by = pg_temp.u47(2), approval_decided_at = now()
 where title = 'Ann approved later #4700';
select set_config('osubb.deciding_approval', 'off', true);
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'approved', 'precondition: approved by hand');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set pinned = true where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'approved', 'pinning is not a content edit');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set body = 'edited by the author' where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'pending',
  'the author editing an approved OSUBB-wide Announcement re-enters review');
select is((pg_temp.ann('Ann approved later #4700')).approval_decided_by, null, 'and the old decision is cleared');
select is((select count(*) from pg_temp.told('Cerere de aprobare: Ann approved later #4700'))::int, 2,
  'BC and the Moderator are asked again');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set approval_status = 'approved' where title = 'Ann pending #4700';
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending', 'a client cannot write the status');

-- ==================== 4. Events ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev pending #4700', 'activitate', (select org from fx47), '2031-05-05 10:00+00')$$,
  'a BCE creates an OSUBB-wide Event');
select lives_ok($$select public.create_event('Ev announced #4700', 'activitate', (select org from fx47), '2031-05-06 10:00+00',
  p_announce => true)$$, 'and one that asks for its Announcement');
reset role;
select is((pg_temp.ev('Ev pending #4700')).approval_status, 'pending', 'the Event waits for approval');
select is((select count(*) from pg_temp.told('Eveniment nou: Ev pending #4700'))::int, 0, 'nobody is told of a pending Event');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ev pending #4700')$$, $$values (2), (3)$$,
  'BC and the Moderator get the request');
select is((pg_temp.ev('Ev announced #4700')).announce_on_approval, true, 'the Announcement waits for the approval');
select is((select count(*) from announcements where title = 'Ev announced #4700'), 0::bigint, 'so no Announcement row exists yet');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from events where title = 'Ev pending #4700'), 0::bigint, 'a third Member cannot read a pending Event');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.create_event('Ev by BC #4700', 'activitate', (select org from fx47), '2031-05-07 10:00+00')$$,
  'BC creates one');
reset role;
select is((pg_temp.ev('Ev by BC #4700')).approval_status, 'approved', 'published at once');
select ok(4 in (select * from pg_temp.told('Eveniment nou: Ev by BC #4700')), 'and its audience is told');
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev to cancel #4700', 'activitate', (select dept from fx47), '2031-05-08 10:00+00')$$,
  'a local Event by the BCE');
reset role;
-- As the owner, no caller (the claims cleared): an approved OSUBB-wide Event of the BCE.
select pg_temp.test_clear_jwt();
update events set group_id = (select org from fx47) where title = 'Ev to cancel #4700';
select is((pg_temp.ev('Ev to cancel #4700')).approval_status, 'approved', 'precondition: approved (moved by the owner, no caller)');
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.cancel_event((pg_temp.ev('Ev to cancel #4700')).id, 'Nu mai e nevoie')$$, 'the author cancels it');
reset role;
select is((pg_temp.ev('Ev to cancel #4700')).approval_status, 'approved', 'a cancellation is not a content edit: no re-entry');

select * from finish();
rollback;
