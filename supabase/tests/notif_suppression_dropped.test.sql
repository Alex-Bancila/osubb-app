-- #1181: public.notif_suppression is dropped, and nothing reads it. No Fan-out
-- ever applied its rows (its only reader filtered kind 'announce', which no row
-- had), so who hears of an Event or an Announcement stays exactly R32 + R42:
-- BCE through membership, a BC member only through a Group position.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ==================== the table and its readers are gone ====================
select is(to_regclass('public.notif_suppression')::text, null::text,
  'public.notif_suppression is dropped');
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}'::text[])
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ilike '%notif_suppression%'),
  '{}'::text[],
  'no public or private function body names notif_suppression');

-- ==================== recipients are unchanged ====================
-- Personas (prefix 1181): 1 Responsible of Root 1181 (Voluntar cu Drept de
-- Vot), who creates and posts; 2 a BC member who is Group Manager of Root
-- (R42: a position reaches the Group); 3 a BCE member of Root; 4 a BC member
-- with a plain roster row on Root (R32: membership alone tells BC nothing);
-- 5 a Voluntar member of Root.
create function pg_temp.u1181(n integer) returns uuid language sql immutable as $$
  select ('11810000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users (id, email)
select pg_temp.u1181(n), 'suppression.' || n || '.1181@test.local' from generate_series(1, 5) as n;
insert into profiles (id, full_name, email, role, status)
select pg_temp.u1181(n), 'Fan-out 1181 ' || n, 'suppression.' || n || '.1181@test.local',
  (case n when 1 then 'vot' when 2 then 'bc' when 3 then 'bce' when 4 then 'bc' else 'voluntar' end)::member_role,
  'activ'
from generate_series(1, 5) as n;
insert into groups (name, category, min_level) values ('Root 1181', 'team', 0);
insert into group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u1181(roster.n), roster.role
from (values (1, 'responsible'), (2, 'manager'), (3, 'member'), (4, 'member'), (5, 'member'))
       as roster(n, role)
cross join (select id from groups where name = 'Root 1181') as grp;

-- The fixture Members told by a notice, as persona numbers.
create function pg_temp.told(p_title text) returns setof integer language sql stable as $$
  select right(member_id::text, 12)::integer
    from public.notifications
   where title = p_title and member_id::text like '11810000-%'
$$;

-- An Event notice (R39: creating an Event notifies its audience).
select pg_temp.test_login_leadership(pg_temp.u1181(1));
select public.create_event('Atelier 1181', 'activitate', (select id from groups where name = 'Root 1181'),
  '2030-09-25 15:40+00', '2030-09-25 17:40+00', 'Sala 305', null, null);
reset role;
select pg_temp.test_clear_jwt();

select ok(2 in (select * from pg_temp.told('Eveniment nou: Atelier 1181')),
  'an Event notice reaches the BC member who holds a position on the Group (R42)');
select ok(3 in (select * from pg_temp.told('Eveniment nou: Atelier 1181')),
  'an Event notice reaches the BCE member of the Group');
select set_eq($$select * from pg_temp.told('Eveniment nou: Atelier 1181')$$,
  array[2, 3, 5],
  'an Event notice reaches exactly the BC position holder, the BCE member and the Voluntar: never the plain BC roster member (R32) or the creator');

-- An Announcement notice, written server-side as the Responsible.
insert into announcements (title, body, group_id, audience, created_by)
select 'Anunt 1181', 'Body 1181', id, 'local', pg_temp.u1181(1)
  from groups where name = 'Root 1181';

select ok(2 in (select * from pg_temp.told('Anunț nou: Anunt 1181')),
  'an Announcement notice reaches the BC member who holds a position on the Group (R42)');
select ok(3 in (select * from pg_temp.told('Anunț nou: Anunt 1181')),
  'an Announcement notice reaches the BCE member of the Group');
select set_eq($$select * from pg_temp.told('Anunț nou: Anunt 1181')$$,
  array[2, 3, 5],
  'an Announcement notice reaches exactly the BC position holder, the BCE member and the Voluntar: never the plain BC roster member (R32) or the author');

select * from finish();
rollback;
