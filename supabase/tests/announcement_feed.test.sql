-- Anunțuri by the page (spec 2026-10-14 "Fast reads everywhere", part 4;
-- ruling R56).
--
-- public.announcement_feed returns the feed the Anunțuri page draws, 20 at a
-- time: the Announcements (never a Deal) the caller reads -- exactly what
-- announcements_read gives them --, narrowed by Grupuri preferate (R43: a
-- preferred Group, or critical, or organization-wide, or their own) and by
-- the Group filter (the chosen Group and every Group below it), in R15's
-- order (pinned, then unread, then read; newest first in each; the id last),
-- with the unpaged count. public.announcement_feed_summary answers what the
-- page shows around it: the unread count of the header, the first unread
-- critical Announcement the banner points at, and the counts the empty
-- states tell apart.
--
-- Mutation record (2026-10-14; each rule broken alone, the suite run): the
-- feed without the Audience, the local Audience, Private Groups, the
-- Minimum Level or the approval rule, or with Deals; Grupuri preferate ignored, or
-- forgetting its critical, organization-wide or own exemption; the Group
-- filter on the exact Group only; read before unread; oldest first; the
-- summary counting read ones, pending or rejected ones, or outside the view,
-- or pointing the banner at a read one, one not yet approved or one outside
-- the Group filter; the page order ignoring the reading's moment -- each
-- fails at least one named case or parity above.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(35);

\ir _group_task_fixtures.psql
reset role;

-- ------------------------------------------------------------- the fixture
create function pg_temp.af_meta(p_uid uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
           'member_role', profile.role,
           'member_level', role.level,
           'group_ids', coalesce((
             select jsonb_agg(membership.group_id order by membership.group_id)
               from public.group_members as membership
              where membership.member_id = profile.id), '[]'::jsonb))
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = p_uid
$$;

-- A statement's ids, in order, as the caller through RLS.
create function pg_temp.af_ids(p_uid uuid, p_sql text, p_meta jsonb default null)
returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  perform pg_temp.test_login(p_uid, coalesce(p_meta, pg_temp.af_meta(p_uid)));
  execute format('select coalesce(array_agg(x order by n), ''{}'') from (select x, row_number() over () as n from (%s) as q(x)) as r', p_sql)
    into v_ids;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

create function pg_temp.af_row(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v_row jsonb;
begin
  perform pg_temp.test_login(p_uid, pg_temp.af_meta(p_uid));
  execute format('select to_jsonb(q) from (%s) as q', p_sql) into v_row;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_row;
end;
$$;

-- The Groups the page treated as unticked: my_group_preferences' rows that
-- are not selected and carry no lock reason (lib/preferred-groups.ts mutedGroupIds).
create function pg_temp.af_muted(p_uid uuid) returns bigint[] language plpgsql as $$
declare
  v_ids bigint[];
begin
  perform pg_temp.test_login(p_uid, pg_temp.af_meta(p_uid));
  select coalesce(array_agg(row_.group_id order by row_.group_id), '{}')
    into v_ids
    from public.my_group_preferences() as row_
   where not row_.selected and row_.locked is null;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_ids;
end;
$$;

create function pg_temp.af_gid(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;

create temp table af(name text primary key, id bigint);
grant select on af to authenticated;

create function pg_temp.af_post(p_name text, p_group text, p_audience text, p_minutes_ago integer,
                                p_priority text default 'normal', p_pinned boolean default false,
                                p_by integer default 1, p_status text default 'approved',
                                p_kind text default 'announcement', p_min_level integer default null)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.announcements(title, body, group_id, audience, priority, pinned, created_by,
                                   approval_status, kind, published_at, min_level)
  values ('Anunț #AF ' || p_name, 'Text', pg_temp.af_gid(p_group), p_audience,
          p_priority::public.announce_priority, p_pinned, pg_temp.g521_uid(p_by), p_status, p_kind,
          now() - make_interval(mins => p_minutes_ago), coalesce(p_min_level, 0))
  returning id into v_id;
  insert into af values (p_name, v_id);
  return v_id;
end;
$$;

-- The feed is this suite's alone: the seed's Announcements (a pinned one, an
-- unread critical one) would rightly come first and count.
delete from public.announcements;

select pg_temp.af_post('pinned', 'Department #521', 'org', 7200, p_pinned => true);
select pg_temp.af_post('dept', 'Department #521', 'local', 5760);
select pg_temp.af_post('critical', 'Child #521', 'local', 4320, p_priority => 'critical');
select pg_temp.af_post('project', 'Project #521', 'local', 2880, p_by => 2);
-- In the Project too: a critical one, and one BC member #1 posted.
select pg_temp.af_post('project critical', 'Project #521', 'local', 2700, p_priority => 'critical', p_by => 2);
select pg_temp.af_post('project own', 'Project #521', 'local', 2600, p_by => 1);
select pg_temp.af_post('independent', 'Independent #521', 'org', 1440, p_by => 6);
-- #5's own Announcement: an author has read what they posted.
select pg_temp.af_post('own', 'Department #521', 'local', 1, p_by => 5);
select pg_temp.af_post('deal', (select name from public.groups where is_organization), 'org', 10, p_kind => 'deal');
select pg_temp.af_post('bulk ' || n, 'Department #521', 'org', 100 + n) from generate_series(1, 25) as n;
-- The read rule's other parts, each keeping one from someone: an
-- organization-wide Announcement of a Private Group (#756) only its member
-- #2 reads; one at Minimum Level 5 (#909) reads from BCE up; and an
-- organization-wide one #6, a Volunteer, asked for -- the stamp judges an
-- insert by its signed-in writer -- reads, while pending, for #6 and level 6.
insert into public.groups(name, category, application_level, is_private) values ('Privat #AF', 'team', 0, true);
insert into public.group_members(group_id, member_id, group_role)
values (pg_temp.af_gid('Privat #AF'), pg_temp.g521_uid(2), 'member');
select pg_temp.af_post('private', 'Privat #AF', 'org', 300, p_by => 2);
select pg_temp.af_post('level five', 'Department #521', 'org', 400, p_min_level => 5);
select set_config('request.jwt.claims',
                  jsonb_build_object('sub', pg_temp.g521_uid(6), 'role', 'authenticated')::text, true);
select pg_temp.af_post('requested', 'Department #521', 'org', 500, p_by => 6);
select pg_temp.test_clear_jwt();
-- An author always reads their own (#909): #2, a Volunteer, wrote one at
-- Minimum Level 5 -- a server-side write, as an author demoted since.
select pg_temp.af_post('own level five', 'Department #521', 'org', 450, p_by => 2, p_min_level => 5);
-- A Member deactivated since, who wrote an organization-wide Announcement:
-- their token outlives them, with the BC claims it was signed with.
insert into auth.users(id, email) values ('af000000-0000-0000-0000-000000000001', 'gone.af@test.local');
insert into public.profiles(id, full_name, email, role, status)
values ('af000000-0000-0000-0000-000000000001', 'Gone #AF', 'gone.af@test.local', 'bc', 'inactiv');
insert into public.announcements(title, body, group_id, audience, priority, created_by, kind, published_at, min_level)
values ('Anunț #AF gone', 'Text', pg_temp.af_gid('Department #521'), 'org', 'normal',
        'af000000-0000-0000-0000-000000000001', 'announcement', now() - interval '30 days', 0);

-- #5 has read the Department's local Announcement.
insert into public.announcement_reads(announcement_id, member_id)
select id, pg_temp.g521_uid(5) from af where name = 'dept';

-- BC member #1 joins the Project as a plain member -- in its Audience, with
-- no position that would lock the preference -- and unticks it and the
-- Independent Team (R43).
insert into public.group_members(group_id, member_id, group_role)
values (pg_temp.af_gid('Project #521'), pg_temp.g521_uid(1), 'member');
select pg_temp.test_login(pg_temp.g521_uid(1), pg_temp.af_meta(pg_temp.g521_uid(1)));
select public.set_unselected_groups(array[pg_temp.af_gid('Project #521'), pg_temp.af_gid('Independent #521')]);
select set_config('role', 'none', true);
select pg_temp.test_clear_jwt();
-- BCE member #9 joins the Project too and unticks it, so the badge's R43
-- has a caller it applies to: from level 5 up, and not BC, who counts only
-- what their own position reaches (R42).
insert into public.group_members(group_id, member_id, group_role)
values (pg_temp.af_gid('Project #521'), pg_temp.g521_uid(9), 'member');
select pg_temp.test_login(pg_temp.g521_uid(9), pg_temp.af_meta(pg_temp.g521_uid(9)));
select public.set_unselected_groups(array[pg_temp.af_gid('Project #521')]);
select set_config('role', 'none', true);
select pg_temp.test_clear_jwt();

create function pg_temp.af_id(p_name text) returns bigint language sql stable as $$
  select id from af where name = p_name
$$;

create temp table af_callers(uid uuid);
insert into af_callers select id from public.profiles where status = 'activ';

-- ---------------------------------------------------------------- shape
select has_function('public', 'announcement_feed', array['bigint', 'boolean', 'integer', 'integer', 'timestamp with time zone'],
                    'public.announcement_feed(group, preferred, limit, offset, as_of) exists');
select has_function('public', 'announcement_feed_summary', array['bigint', 'boolean'],
                    'public.announcement_feed_summary(group, preferred) exists');

-- ----------------------------------------------------------------- parity
select is_empty($$
  select caller.uid
    from af_callers as caller
   where (select array_agg(id order by id) from unnest(pg_temp.af_ids(caller.uid,
            'select id from public.announcement_feed(p_limit => 100)')) as id)
         is distinct from
         (select array_agg(id order by id) from unnest(pg_temp.af_ids(caller.uid,
            'select id from public.announcements where kind = ''announcement''')) as id)
$$, 'the feed holds exactly the Announcements announcements_read gives each caller, and no Deal');
select is_empty($$
  select caller.uid
    from af_callers as caller
   where (select array_agg(id order by id) from unnest(pg_temp.af_ids(caller.uid,
            'select id from public.announcement_feed(p_preferred => true, p_limit => 100)')) as id)
         is distinct from
         (select array_agg(id order by id) from unnest(pg_temp.af_ids(caller.uid, format(
            'select id from public.announcements where kind = ''announcement''
               and (not (group_id = any(%L::bigint[])) or priority = ''critical'' or audience = ''org''
                    or created_by = auth.uid())',
            pg_temp.af_muted(caller.uid)))) as id)
$$, 'Grupuri preferate keeps what the page kept: a preferred Group, critical, organization-wide or one''s own');

-- ---------------------------------------------------------- the named cases
select ok(not pg_temp.af_id('project') = any(pg_temp.af_ids(pg_temp.g521_uid(1),
            'select id from public.announcement_feed(p_preferred => true, p_limit => 100)'))
          and pg_temp.af_id('independent') = any(pg_temp.af_ids(pg_temp.g521_uid(1),
            'select id from public.announcement_feed(p_preferred => true, p_limit => 100)'))
          and pg_temp.af_id('project') = any(pg_temp.af_ids(pg_temp.g521_uid(1),
            'select id from public.announcement_feed(p_limit => 100)')),
          'R43: an unticked Group''s local Announcement leaves the preferred view, its org one stays, Arată tot shows both');
select ok(pg_temp.af_id('project critical') = any(pg_temp.af_ids(pg_temp.g521_uid(1),
            'select id from public.announcement_feed(p_preferred => true, p_limit => 100)'))
          and pg_temp.af_id('project own') = any(pg_temp.af_ids(pg_temp.g521_uid(1),
            'select id from public.announcement_feed(p_preferred => true, p_limit => 100)')),
          'R43: an unticked Group''s critical Announcement, and one''s own, stay');
select ok(pg_temp.af_id('critical') = any(pg_temp.af_ids(pg_temp.g521_uid(8),
            format('select id from public.announcement_feed(p_group_id => %s, p_limit => 100)', pg_temp.af_gid('Department #521'))))
          and not pg_temp.af_id('critical') = any(pg_temp.af_ids(pg_temp.g521_uid(8),
            format('select id from public.announcement_feed(p_group_id => %s, p_limit => 100)', pg_temp.af_gid('Independent #521')))),
          'the Group filter holds the chosen Group and every Group below it');
select is((pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 100)'))[1:2],
          array[pg_temp.af_id('pinned'), pg_temp.af_id('bulk 1')],
          'R15: the pinned one first, then the unread ones, newest first');
select is((select ids[array_length(ids, 1)] from (select pg_temp.af_ids(pg_temp.g521_uid(5),
            'select id from public.announcement_feed(p_limit => 100)') as ids) as q),
          pg_temp.af_id('dept'),
          'R15: a read one after every unread one');
select ok(pg_temp.af_id('deal') <> all(pg_temp.af_ids(pg_temp.g521_uid(1), 'select id from public.announcement_feed(p_limit => 100)')),
          'a Deal is never in the feed, even for BC');

-- ------------------------------------------------------------------ pages
select is(cardinality(pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed()')), 20,
          'a page holds 20 by default');
select is(
  pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 10)')
  || pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 10, p_offset => 10)')
  || pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 10, p_offset => 20)'),
  pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 30)'),
  'consecutive pages neither skip nor repeat an Announcement');
select is((pg_temp.af_row(pg_temp.g521_uid(5), 'select total, read_at is null as unread from public.announcement_feed(p_limit => 1)') ->> 'total')::int,
          cardinality(pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcements where kind = ''announcement''')),
          'each row carries the unpaged count');
select is((pg_temp.af_row(pg_temp.g521_uid(5), format('select read_at is not null as read from public.announcement_feed(p_limit => 100) where id = %s', pg_temp.af_id('dept'))) ->> 'read')::boolean,
          true, 'each row carries the caller''s own read time');

-- ------------------------------------------- one reading, one moment
-- #5 reads the first unread one a minute into a reading: as of the moment
-- their reading began it is still unread, so every page of that reading keeps
-- its place -- the next page neither skips nor repeats a card. A reading
-- begun after it sees it read.
create temp table af_reading as
select pg_temp.af_ids(pg_temp.g521_uid(5),
         'select id from public.announcement_feed(p_limit => 100, p_as_of => now())') as ids;
grant select on af_reading to authenticated;
insert into public.announcement_reads(announcement_id, member_id, read_at)
select (select ids[2] from af_reading), pg_temp.g521_uid(5), now() + interval '1 minute';
select is(pg_temp.af_ids(pg_temp.g521_uid(5),
            'select id from public.announcement_feed(p_limit => 100, p_as_of => now())'),
          (select ids from af_reading),
          'one reading keeps its order while the Member reads: a read after its moment still orders as unread');
select isnt(pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcement_feed(p_limit => 100, p_as_of => now() + interval ''2 minutes'')'),
            (select ids from af_reading),
            'a reading begun after the read orders it among the read ones');
select is((pg_temp.af_row(pg_temp.g521_uid(5),
             'select as_of = now() as now, (select as_of from public.announcement_feed(p_limit => 1, p_as_of => now() - interval ''1 minute'')) = now() - interval ''1 minute'' as passed
                from public.announcement_feed(p_limit => 1)')),
          '{"now": true, "passed": true}'::jsonb,
          'as_of answers the moment used: now for a first page, the one passed on for the next');

-- --------------------------------------------------------------- summary
select is(pg_temp.af_row(pg_temp.g521_uid(5), 'select unread, critical_id, everything, preferred from public.announcement_feed_summary()'),
          jsonb_build_object(
            'unread', cardinality(pg_temp.af_ids(pg_temp.g521_uid(5),
              'select id from public.announcements as a where kind = ''announcement'' and approval_status = ''approved''
                 and not exists (select 1 from public.announcement_reads as r
                                  where r.announcement_id = a.id and r.member_id = auth.uid())')),
            'critical_id', pg_temp.af_id('project critical'),
            'everything', cardinality(pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcements where kind = ''announcement''')),
            'preferred', cardinality(pg_temp.af_ids(pg_temp.g521_uid(5), 'select id from public.announcements where kind = ''announcement'''))),
          'summary: the approved unread ones (not the one read, nor one''s own), the Project''s critical one, and both counts');
select is((pg_temp.af_row(pg_temp.g521_uid(8), 'select critical_id from public.announcement_feed_summary()') ->> 'critical_id')::bigint,
          pg_temp.af_id('critical'), 'summary: the first unread critical Announcement, for the banner');
insert into public.announcement_reads(announcement_id, member_id)
select id, pg_temp.g521_uid(8) from af where name = 'critical';
select is(pg_temp.af_row(pg_temp.g521_uid(8), 'select critical_id from public.announcement_feed_summary()') -> 'critical_id',
          'null'::jsonb, 'summary: none once it is read');
select is((pg_temp.af_row(pg_temp.g521_uid(1), 'select everything - preferred as hidden from public.announcement_feed_summary(p_preferred => true)') ->> 'hidden')::int,
          1, 'summary: the preferred view hides the unticked Group''s one local Announcement');
select is((pg_temp.af_row(pg_temp.g521_uid(1), 'select unread from public.announcement_feed_summary(p_preferred => true)') ->> 'unread')::int,
          (pg_temp.af_row(pg_temp.g521_uid(1), 'select unread from public.announcement_feed_summary()') ->> 'unread')::int - 1,
          'summary: the header counts the view it is in -- the unticked Group''s unread local one leaves the preferred count');
select is(pg_temp.af_row(pg_temp.g521_uid(5), format('select critical_id from public.announcement_feed_summary(p_group_id => %s)',
                                                     pg_temp.af_gid('Independent #521'))) -> 'critical_id',
          'null'::jsonb,
          'summary: the banner keeps to the Group filter -- none in a Group without a critical one');

-- ------------------------------- what BC reads before it is approved
-- BC reads two organization-wide critical Announcements #6, a Volunteer,
-- asked for -- newer than any other -- one still pending, one rejected:
-- neither waits for BC to read it, and the banner points at neither. The
-- stamp judges an insert by its signed-in writer, and the rejection is
-- written as the decision command writes it (osubb.deciding_approval).
select set_config('request.jwt.claims',
                  jsonb_build_object('sub', pg_temp.g521_uid(6), 'role', 'authenticated')::text, true);
select pg_temp.af_post('pending critical', 'Department #521', 'org', 0, p_priority => 'critical', p_by => 6);
select pg_temp.af_post('rejected critical', 'Department #521', 'org', 0, p_priority => 'critical', p_by => 6);
select pg_temp.test_clear_jwt();
select set_config('osubb.deciding_approval', 'on', true);
update public.announcements
   set approval_status = 'rejected', rejection_reason = 'Nu acum #AF',
       approval_decided_by = pg_temp.g521_uid(1), approval_decided_at = now()
 where id = pg_temp.af_id('rejected critical');
select set_config('osubb.deciding_approval', '', true);
select ok(array[pg_temp.af_id('pending critical'), pg_temp.af_id('rejected critical')]
            <@ pg_temp.af_ids(pg_temp.g521_uid(1), 'select id from public.announcement_feed(p_limit => 100)
                                                     where approval_status in (''pending'', ''rejected'')'),
          'BC''s feed holds a pending and a rejected Announcement');
select is(pg_temp.af_row(pg_temp.g521_uid(1), 'select unread, critical_id from public.announcement_feed_summary()'),
          jsonb_build_object(
            'unread', cardinality(pg_temp.af_ids(pg_temp.g521_uid(1),
              'select id from public.announcements as a where kind = ''announcement'' and approval_status = ''approved''
                 and not exists (select 1 from public.announcement_reads as r
                                  where r.announcement_id = a.id and r.member_id = auth.uid())')),
            'critical_id', pg_temp.af_id('project critical')),
          'summary: a pending or rejected Announcement is never unread, and never the banner');

-- ---------------------------------------------------------------- badge
-- The badge counts what it counted when it read the table through
-- announcements_read (20261011140000's body), for every caller and tab.
create function pg_temp.af_badge_reference(p_kind text) returns text language sql immutable as $$
  select format($q$
    select count(*)::bigint
      from public.announcements as announcement
     where announcement.approval_status = 'approved'
       and ((select private.caller_level()) < 6
            or ((select private.caller_level()) = 6
                and exists (select 1
                              from public.groups as origin
                              join public.group_members as held
                                on origin.path @> array[held.group_id]
                               and held.member_id = (select auth.uid())
                               and held.group_role in ('manager', 'responsible')
                             where origin.id = announcement.group_id)))
       and (announcement.priority = 'critical'
            or announcement.audience = 'org'
            or not private.is_group_muted(announcement.group_id))
       and (%1$L::text is null or announcement.kind = %1$L::text)
       and (announcement.kind <> 'deal' or announcement.deadline is null or announcement.deadline >= now())
       and not exists (select 1 from public.announcement_reads as reads
                        where reads.announcement_id = announcement.id
                          and reads.member_id = (select auth.uid())) $q$, p_kind)
$$;
select is_empty($$
  select caller.uid, kinds.kind
    from af_callers as caller
   cross join (values (null::text), ('announcement'), ('deal')) as kinds(kind)
   where pg_temp.af_ids(caller.uid, format('select public.my_unread_announcements_count(%L)::bigint', kinds.kind))
         is distinct from pg_temp.af_ids(caller.uid, pg_temp.af_badge_reference(kinds.kind))
$$, 'the badge counts, for every caller and either tab, what it counted through announcements_read');
select ok((select bool_or(count > 0) and bool_or(count = 0)
             from (select (pg_temp.af_ids(caller.uid, 'select public.my_unread_announcements_count()::bigint'))[1] as count
                     from af_callers as caller) as counts),
          'the badge parity reads something: some callers have unread Announcements, some none');

-- --------------------------------------------- no standing, nothing at all
-- The feed, the summary and the badge, each a set read as the owner: a
-- deactivated Member with stale BC claims -- even their own -- and a live
-- Member whose session carries no organization claims read and count nothing.
select is(pg_temp.af_ids('af000000-0000-0000-0000-000000000001',
            'select (select count(*) from public.announcement_feed(p_limit => 100))
             union all select everything from public.announcement_feed_summary()
             union all select coalesce(critical_id, 0) from public.announcement_feed_summary()
             union all select public.my_unread_announcements_count()',
            jsonb_build_object('member_role', 'bc', 'member_level', 6, 'group_ids', '[]'::jsonb)),
          '{0,0,0,0}'::bigint[],
          'a deactivated Member with stale BC claims reads and counts nothing, not even their own organization-wide Announcement');
select is(pg_temp.af_ids(pg_temp.g521_uid(5),
            'select (select count(*) from public.announcement_feed(p_limit => 100))
             union all select everything from public.announcement_feed_summary()
             union all select coalesce(critical_id, 0) from public.announcement_feed_summary()
             union all select public.my_unread_announcements_count()',
            '{}'::jsonb),
          '{0,0,0,0}'::bigint[],
          'a live Member whose session carries no organization claims reads and counts nothing');
select ok(pg_temp.af_id('own level five') = any(pg_temp.af_ids(pg_temp.g521_uid(2), 'select id from public.announcement_feed(p_limit => 100)'))
          and not pg_temp.af_id('own level five') = any(pg_temp.af_ids(pg_temp.g521_uid(3), 'select id from public.announcement_feed(p_limit => 100)')),
          'an author reads their own above their level; another Volunteer does not');

-- ------------------------------------------------------------- refusals
select throws_ok($$ select * from public.announcement_feed(p_limit => 0) $$, 'PT400', 'invalid_page',
                 'a page of no rows is refused: PT400 invalid_page');
select throws_ok($$ select * from public.announcement_feed(p_limit => 101) $$, 'PT400', 'invalid_page',
                 'a page above 100 rows is refused: PT400 invalid_page');
select throws_ok($$ select * from public.announcement_feed(p_offset => -1) $$, 'PT400', 'invalid_page',
                 'a negative offset is refused: PT400 invalid_page');
select throws_ok($$ select * from public.announcement_feed(p_limit => null) $$, 'PT400', 'invalid_page',
                 'a page with no size is refused: PT400 invalid_page');
select throws_ok($$ select * from public.announcement_feed(p_offset => null) $$, 'PT400', 'invalid_page',
                 'a page with no offset is refused: PT400 invalid_page');

select * from finish();
rollback;
