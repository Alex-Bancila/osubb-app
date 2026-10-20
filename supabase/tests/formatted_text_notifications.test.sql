-- formatted_text_notifications.test.sql -- R60 (Formatted Text): what leaves the
-- Markdown as plain words.
--
-- An Announcement body may hold Markdown now, but a Notification is plain text
-- everywhere it is read (the bell, the push, the Email Digest): private.
-- notify_announcement hands private.notify the words of the body, whether the
-- Member is told for the first time or already holds a notice about it. And an
-- Event's description, copied into its Announcement by private.
-- event_announcement_body, is cut at whole lines -- never inside a marker --
-- until the visible text is within 2000 characters and the stored text within
-- 4000, the closing ellipsis included, on a line of its own; the date line stays.
-- A description that is one long paragraph is never dropped whole: its plain
-- words are kept, cut at the last space inside the limit (ruling 10). With no
-- description at all the copy is the date line, never clipped.
--
-- Personas (prefix 1090): 1 vot, Manager of Dept R60N   2 voluntar, its member
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.u60(n integer) returns uuid language sql immutable as $$
  select ('10900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u60(n), 'notify.' || n || '.r60@test.local' from generate_series(1, 2) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u60(n), 'Notificare R60 ' || n, 'notify.' || n || '.r60@test.local',
       (case n when 1 then 'vot' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 2) n;
insert into public.groups(name, category, min_level) values ('Dept R60N', 'department', 0);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u60(row_.n), row_.group_role
  from (values (1, 'manager'), (2, 'member')) as row_(n, group_role)
  cross join public.groups as grp where grp.name = 'Dept R60N';

create function pg_temp.dept() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = 'Dept R60N'
$$;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
-- The Event copy under test, for a fixed start so its date line has a known
-- length: "Miercuri, 25 septembrie 2030, 18:40".
create function pg_temp.evcopy(p_description text) returns text language sql stable security definer set search_path = '' as $$
  select private.event_announcement_body('2030-09-25 15:40+00', null, null, p_description)
$$;
create function pg_temp.date_line() returns text language sql stable security definer set search_path = '' as $$
  select private.event_announcement_body('2030-09-25 15:40+00', null, null, null)
$$;
create function pg_temp.plain_len(p_text text) returns integer language sql stable security definer set search_path = '' as $$
  select char_length(private.formatted_text_plain(p_text))
$$;

-- ==================== 1. the Notification carries the words ====================
select pg_temp.test_login_leadership(pg_temp.u60(1));
insert into public.announcements(title, body, group_id, audience)
values ('Anunț cu format R60N', E'Ne vedem **joi**.\n- sala 2/I', pg_temp.dept(), 'local');
reset role;
select is((select body from public.notifications
            where title = 'Anunț nou: Anunț cu format R60N' and member_id = pg_temp.u60(2)),
  E'Ne vedem joi.\n• sala 2/I',
  'the first Notification of an Announcement carries the words of its body, markers gone');

-- A Member who already holds the notice is told again with the same words:
-- the approval of an Announcement its audience knew sends no change list.
do $$
begin
  perform private.notify_announcement(pg_temp.ann('Anunț cu format R60N'), null, null);
end;
$$;
select is((select title || ' | ' || body from public.notifications
            where dedupe_key = 'announcement:' || (pg_temp.ann('Anunț cu format R60N')).id::text
              and member_id = pg_temp.u60(2)),
  E'Anunț actualizat: Anunț cu format R60N | Ne vedem joi.\n• sala 2/I',
  'a Member who already holds the notice is told again with the words, not the Markdown');

-- ==================== 2. the Event copy is cut at whole lines ====================
-- 30 lines of 70 visible characters (74 stored): with the date line and a
-- blank line they are 2166 visible characters, so lines go from the end.
-- kept = the lines between the blank line and the ellipsis; given = the
-- description's own lines.
create temp table copy30 as
select body,
       (string_to_array(body, E'\n'))[3 : cardinality(string_to_array(body, E'\n')) - 1] as kept,
       string_to_array(description, E'\n') as given
  from (select description, private.event_announcement_body(now() + interval '1 day', null, null, description) as body
          from (select array_to_string(array_fill('**' || repeat('x', 70) || '**', array[30]), E'\n') as description) as d) as c;

select ok(pg_temp.plain_len((select body from copy30)) <= 2000,
  'an Event description over the limit is copied within 2000 visible characters');
select ok((select body from copy30) like E'%\n…',
  'a cut copy ends with an ellipsis on a line of its own');
select ok(
  (select kept = given[1 : cardinality(kept)]
          and cardinality(kept) > 0
          and (string_to_array(body, E'\n'))[cardinality(string_to_array(body, E'\n'))] = '…'
          and (select bool_and(line ~ '^\*\*x{70}\*\*$') from unnest(kept) as line)
     from copy30),
  'every line before the ellipsis is an input line unchanged, in order, and none ends inside a marker');
select ok(
  (select pg_temp.plain_len(left(body, -2) || E'\n' || given[cardinality(kept) + 1] || E'\n…') > 2000
     from copy30),
  'the copy keeps as many lines as fit: one more line, ellipsis included, would pass the limit');

-- ==================== 3. the boundary: the ellipsis is inside the limit ====================
-- date_line + blank line + a line of L characters + "\n…" is exactly 2000
-- visible characters when L = 1996 - length(date_line). The next line is
-- dropped, the first one stays.
select is(pg_temp.evcopy(repeat('a', 1996 - char_length(pg_temp.date_line())) || E'\nbbbb'),
  pg_temp.date_line() || E'\n\n' || repeat('a', 1996 - char_length(pg_temp.date_line())) || E'\n…',
  'a copy that fits the limit exactly, ellipsis included, keeps its last whole line');
-- One character longer and the ellipsis would make 2001: the second line goes
-- too, though the copy without its ellipsis would have been within 2000. Three
-- lines: aaa, a line of 1993 - length(date_line) characters, then cccc.
select is(pg_temp.evcopy(E'aaa\n' || repeat('b', 1993 - char_length(pg_temp.date_line())) || E'\ncccc'),
  pg_temp.date_line() || E'\n\naaa\n…',
  'a line the ellipsis would push over the limit is dropped as well');

-- ==================== 3b. one long paragraph is never dropped whole ====================
-- A description that is one over-long line has no whole line to keep, so the
-- copy keeps that line's plain words, cut at the last space inside the 2000
-- characters (date line, blank line and closing ellipsis included). A single
-- line of 1990 characters with a bold word: 1986 visible, 2027 with the date line.
create temp table para as
select pg_temp.evcopy(repeat('x', 1000) || ' **bold** ' || repeat('x', 980)) as body;
select ok(
  (select pg_temp.plain_len(body) <= 2000
          and char_length(body) <= 4000
          and body like pg_temp.date_line() || E'\n\n%'
          and body not like '%**%'
          and body like E'%\n…'
     from para),
  'one long paragraph is copied within the limits, date line first, markers gone, ending with an ellipsis');
select is((select body from para),
  pg_temp.date_line() || E'\n\n' || repeat('x', 1000) || ' bold' || E'\n…',
  'its plain words are cut at the last space inside the limit, never inside a word it can step back from');
-- No space to step back to: the cut is at the budget, which fills the limit exactly.
select is(pg_temp.evcopy(repeat('x', 2000)),
  pg_temp.date_line() || E'\n\n' || repeat('x', 2000 - char_length(pg_temp.date_line()) - 4) || E'\n…',
  'a paragraph without a space is cut at the budget: exactly 2000 visible characters');
-- Leading blank lines are not the description's first line.
select is(pg_temp.evcopy(E'\n' || repeat('x', 2000)),
  pg_temp.date_line() || E'\n\n' || repeat('x', 2000 - char_length(pg_temp.date_line()) - 4) || E'\n…',
  'the plain words come from the first line that has any');

-- Stored 4000 is a limit of its own: 7 lines of 189 visible characters
-- (569 stored) are 1366 visible but 4026 stored with the date line.
select ok(
  (with cp as (
     select pg_temp.evcopy(array_to_string(array_fill(repeat('**a** ', 94) || '**a**', array[7]), E'\n')) as body)
   select char_length(body) <= 4000
          and pg_temp.plain_len(body) <= 2000
          and body like E'%\n…'
          and cardinality(string_to_array(body, E'\n')) = 2 + 6 + 1
     from cp),
  'the stored 4000 cuts a copy at a line too: 6 of the 7 lines stay');

-- ==================== 4. a short description is copied whole ====================
select is(pg_temp.evcopy(E'Aduceți **laptopul**.\n- una'),
  pg_temp.date_line() || E'\n\n' || E'Aduceți **laptopul**.\n- una',
  'a description within the limits is copied unchanged after the date line, markers included');

-- ==================== 5. no description, no clip ====================
-- private.notify_event asks for the date line alone (a null description). The
-- clip runs only on a description: with none it has no lines to count down
-- and would never end. A date line over the limit cannot be stored
-- (events_location_length_ck), so the copy is called directly with one, and
-- the statement timeout turns a loop into a failure.
select is(pg_temp.evcopy(null), 'Miercuri, 25 septembrie 2030, 18:40',
  'with no description the copy is the date line alone');
set local statement_timeout = '10s';
select is(private.event_announcement_body('2030-09-25 15:40+00', null, repeat('x', 2100), null),
  'Miercuri, 25 septembrie 2030, 18:40 · ' || repeat('x', 2100),
  'a null description is never clipped, even under a date line over the limit');
set local statement_timeout to default;

select * from finish();
rollback;
