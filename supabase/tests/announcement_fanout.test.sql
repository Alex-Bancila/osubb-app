-- #68: exact announcement broadcast recipients, suppression, and author exclusion.
-- #861: the author's own read row, the announcement:<id> key and read-clears-notification.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.u68(n integer) returns uuid language sql immutable as $$
  select ('68000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id,email)
select pg_temp.u68(n),'announce.'||n||'.68@test.local' from generate_series(1,8) n;
insert into profiles(id,full_name,email,role,status)
select pg_temp.u68(n),'Announcement #68 '||n,'announce.'||n||'.68@test.local',
  (case when n=4 then 'bce' when n=6 then 'vot' when n=8 then 'bc' else 'voluntar' end)::member_role,
  (case when n=5 then 'inactiv' else 'activ' end)::member_status
from generate_series(1,8) n;
insert into groups(name,category,min_level) values ('Root #68','team',0);
insert into groups(name,category,parent_id,application_level)
values ('Child #68','team',(select id from groups where name='Root #68'),0);
insert into groups(name,category,parent_id,min_level,automatic_membership)
values ('Automatic #68','team',(select id from groups where name='Root #68'),3,true);
insert into group_members(group_id,member_id,group_role)
select grp.id,pg_temp.u68(n),role
from (values ('Root #68',1,'responsible'),('Root #68',2,'member'),
             ('Child #68',3,'member'),('Root #68',4,'member'),
             ('Child #68',5,'member')) as roster(name,n,role)
join groups as grp on grp.name=roster.name;
insert into notif_suppression(role,kind) values ('bce','announce');

insert into announcements(title,body,group_id,audience,created_by)
select 'Local #68','Body #68',id,'local',pg_temp.u68(1)
from groups where name='Root #68';
select set_eq(
$$select member_id from notifications where title='Anunț nou: Local #68' and member_id::text like '68000000-%'$$,
$$select pg_temp.u68(n) from (values (2),(3),(6),(8)) v(n)$$,
'local fan-out reaches root and descendant roster/Automatic Members, including BC');
select is((select count(*) from notifications where title='Anunț nou: Local #68'),
  4 + (select count(*) from profiles p join roles r on r.id=p.role
       where p.email like '%@demo.osubb' and p.status='activ' and r.level>=3
         and not exists (select 1 from notif_suppression s where s.role=p.role and s.kind='announce')),
'local broadcast includes every seeded Automatic Member exactly once as well as the four fixture recipients');
select is((select count(*) from notifications where title='Anunț nou: Local #68' and member_id=pg_temp.u68(1)),0::bigint,
'author receives no local Notification');
select is((select count(*) from notifications where title='Anunț nou: Local #68' and member_id=pg_temp.u68(4)),0::bigint,
'BCE is suppressed only because the lookup contains announce');
-- #843 (D14): the link opens the Announcement itself, not the feed.
select ok((select bool_and(kind='announce' and body='Body #68'
                          and link='/anunturi?anunt=' || (select id from announcements where title='Local #68')::text)
from notifications where title='Anunț nou: Local #68'),
'Notification kind, route and body point to the Announcement itself (/anunturi?anunt=<id>)');

insert into announcements(title,body,group_id,audience,created_by)
select 'Org #68','Org body',id,'org',pg_temp.u68(1)
from groups where name='Root #68';
select set_eq(
$$select member_id from notifications where title='Anunț nou: Org #68' and member_id::text like '68000000-%'$$,
$$select pg_temp.u68(n) from (values (2),(3),(6),(7),(8)) v(n)$$,
'org Audience reaches every active fixture Member except author and suppressed BCE');
select is((select count(*) from notifications where title='Anunț nou: Org #68'),
(select count(*) from private.group_audience((select id from groups where is_organization)) as r(member_id)
 join profiles p on p.id=r.member_id
 where r.member_id<>pg_temp.u68(1)
   and not exists (select 1 from notif_suppression s where s.role=p.role and s.kind='announce')),
'org fan-out total exactly equals the shared Group Audience minus author and suppression');
select is((select group_id from announcements where title='Org #68'),
(select id from groups where name='Root #68'),
'organization Audience leaves the Origin Group unchanged');

-- Changing reference data changes recipients without changing trigger code.
delete from notif_suppression where role='bce' and kind='announce';
insert into announcements(title,body,group_id,audience,created_by)
select 'Unsuppressed #68','Body',id,'local',pg_temp.u68(1)
from groups where name='Root #68';
select is((select count(*) from notifications where title='Anunț nou: Unsuppressed #68'),
  5 + (select count(*) from profiles p join roles r on r.id=p.role
       where p.email like '%@demo.osubb' and p.status='activ' and r.level>=3),
'removing suppression restores BCE delivery while retaining all seeded Automatic Members');
select is((select count(*) from notifications where title='Anunț nou: Unsuppressed #68' and member_id=pg_temp.u68(4)),1::bigint,
'BCE receives the broadcast when its suppression row is absent');

-- The authenticated actor wins over a forgeable created_by field for echo suppression.
select pg_temp.test_login_leadership(pg_temp.u68(1));
select lives_ok($$insert into announcements(title,body,group_id,audience,created_by)
select 'Actor #68','Body',id,'local',pg_temp.u68(2)
from groups where name='Root #68'$$,'Responsible can post while naming another byline');
reset role;
select is((select count(*) from notifications where title='Anunț nou: Actor #68' and member_id=pg_temp.u68(1)),0::bigint,
'authenticated actor never receives their own broadcast despite forged created_by');
select is((select count(*) from notifications where title='Anunț nou: Actor #68' and member_id=pg_temp.u68(2)),1::bigint,
'forged byline does not suppress the actual recipient');
select ok(not exists (select 1 from notifications where title like 'Anunț nou: % #68' and member_id=pg_temp.u68(5)),
'inactive Member receives no announcement Notification');

-- ==================== #861 (Audit D-12, D-20) ====================

-- D-12: the author has read what they wrote -- when inside its read audience.
select is((select count(*) from announcement_reads
            where announcement_id=(select id from announcements where title='Local #68')
              and member_id=pg_temp.u68(1)),1::bigint,
'#861 D-12: the author (the Group Responsible, inside the local read audience) gets their own read row');
-- BC (u68(8)) is a global writer but neither on the Child roster nor holding a
-- position on its path, so a local Child Announcement is outside their audience.
-- Written server-side (no session), so created_by stands as given.
select pg_temp.test_clear_jwt();
insert into announcements(title,body,group_id,audience,created_by)
select 'Outside #68','Body',id,'local',pg_temp.u68(8)
from groups where name='Child #68';
select is((select count(*) from announcement_reads
            where announcement_id=(select id from announcements where title='Outside #68')),0::bigint,
'#861 D-12: an author outside the Announcement''s read audience gets no read row');

-- D-20: the Notification carries announcement:<id>, and reading clears only
-- the reader's own.
select ok((select bool_and(dedupe_key='announcement:' || (select id from announcements where title='Local #68')::text)
             from notifications where title='Anunț nou: Local #68'),
'#861 D-20: every "Anunț nou" Notification carries the dedupe key announcement:<id>');
insert into announcement_reads(announcement_id,member_id)
values ((select id from announcements where title='Local #68'),pg_temp.u68(2));
select ok((select read from notifications where title='Anunț nou: Local #68' and member_id=pg_temp.u68(2))
          and not (select read from notifications where title='Anunț nou: Local #68' and member_id=pg_temp.u68(3)),
'#861 D-20: a read row marks the reader''s own "Anunț nou" Notification read, and nobody else''s');

-- D-20 backfill: rows delivered before the key, linked by #843. Replay the
-- migration's recorded notification updates on a pre-#861 shape.
alter table announcements disable trigger announcements_fan_out;
insert into announcements(title,body,group_id,audience,created_by)
select 'Backfill #861','Body',id,'org',pg_temp.u68(8) from groups where name='Root #68';
alter table announcements enable trigger announcements_fan_out;
insert into notifications(member_id,kind,title,link,created_at)
select pg_temp.u68(n),'announce','Anunț nou: Backfill #861',
       '/anunturi?anunt=' || (select id from announcements where title='Backfill #861')::text,
       now() - make_interval(mins => m)
from (values (2,2),(3,2),(3,1)) as v(n,m);
insert into announcement_reads(announcement_id,member_id)
values ((select id from announcements where title='Backfill #861'),pg_temp.u68(2));

create function pg_temp.replay_861_backfill() returns integer language plpgsql as $fn$
declare
  v_statement text;
  v_count     integer := 0;
begin
  for v_statement in
    select statement
      from supabase_migrations.schema_migrations as migration,
           unnest(migration.statements) as statement
     where migration.version = '20260928120000'
       and statement ~* 'update public\.notifications'
       and statement !~* 'create (or replace )?function'
  loop
    execute v_statement;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;
select is(pg_temp.replay_861_backfill(),2,
'#861 D-20 backfill: the migration recorded its two notification updates, and they replay');
select is((select count(*) from notifications
            where title='Anunț nou: Backfill #861' and member_id=pg_temp.u68(2) and not read),0::bigint,
'#861 D-20 backfill: no unread "Anunț nou" row is left for a member who already read the Announcement');
select is((select string_agg(coalesce(dedupe_key,'<none>') || ':' || read::text, ',' order by id)
             from notifications where title='Anunț nou: Backfill #861' and member_id=pg_temp.u68(3)),
  '<none>:false,announcement:' || (select id from announcements where title='Backfill #861')::text || ':false',
'#861 D-20 backfill: an unread row takes the key from its link -- only the newest of two, as the unique index admits one');
select * from finish();
rollback;
