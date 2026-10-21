-- R60 scan of old rows (read-only). Run before the reader (#1091) reaches a
-- database's Members: it lists the existing text whose look will change once
-- the app reads it as Formatted Text.
--
-- The test: a row "changes" when private.formatted_text_plain (the server's
-- stripper, migration 20261020213926_formatted_text.sql) gives something other
-- than the text itself with its line breaks folded and its spaces trimmed. A
-- line starting "- " that becomes "• " counts: it will render as a list.
--
-- It reads only. Run it in the SQL editor of a database that already has the
-- R60 migration (staging after #1094; production after the Release that
-- carries it). Fix an odd row by editing that item in the app, never by SQL.

with source_rows as (
  select 'announcement' as source, a.id::text as id, a.body as txt
    from public.announcements as a
  union all
  select 'task', t.id::text, t.description
    from public.tasks as t
   where t.description is not null
  union all
  select 'event', e.id::text, e.description
    from public.events as e
   where e.description is not null
  union all
  select 'task history (before)', ta.id::text, ta.details -> 'before' ->> 'description'
    from public.task_activity as ta
   where ta.details -> 'before' ->> 'description' is not null
  union all
  select 'task history (after)', ta.id::text, ta.details -> 'after' ->> 'description'
    from public.task_activity as ta
   where ta.details -> 'after' ->> 'description' is not null
),
changed as (
  select source, id, txt, private.formatted_text_plain(txt) as reads_as
    from source_rows
   where private.formatted_text_plain(txt) is distinct from btrim(replace(txt, E'\r\n', E'\n'), ' ')
),
counts as (
  select s.source,
         count(*) as rows_total,
         (select count(*) from changed as c where c.source = s.source) as rows_that_change
    from source_rows as s
   group by s.source
),
samples as (
  select source, id, txt, reads_as,
         row_number() over (partition by source order by id) as n
    from changed
)
select k.source,
       k.rows_total,
       k.rows_that_change,
       s.id,
       left(s.txt, 160) as starts_with,
       left(s.reads_as, 160) as plain_words
  from counts as k
  left join samples as s on s.source = k.source and s.n <= 50
 order by k.source, s.n;
