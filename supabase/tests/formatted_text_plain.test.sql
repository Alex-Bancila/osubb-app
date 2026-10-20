-- formatted_text_plain.test.sql -- R60 (Formatted Text): the SQL stripper.
--
-- private.formatted_text_plain turns Formatted Text (a restricted Markdown) into
-- plain words: the visible-length limits count them and a Notification carries
-- them. The fixture lines below are the single source for its TypeScript twin
-- (toPlainText): app/src/lib/formatted-text/plain.test.ts parses this file and
-- runs every fixture through the twin, so each one is exactly one line of the
-- shape that test reads and no other line in this file takes that shape. A `\n`
-- or `\r` is written as an escape inside E'', a literal backslash as `\\` and an
-- invisible character such as the em space U+2003 as the character itself.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- ==================== fixtures ====================

select is(private.formatted_text_plain(E'Ne vedem **joi**.'), E'Ne vedem joi.', 'bold');
select is(private.formatted_text_plain(E'*cursiv* și _cursiv_'), E'cursiv și cursiv', 'italic both');
select is(private.formatted_text_plain(E'5*3*2 și nume_prenume'), E'5*3*2 și nume_prenume', 'intraword literal');
select is(private.formatted_text_plain(E'**Ședința** *și* _țară_ ăla*b*'), E'Ședința și țară ăla*b*', 'diacritics');
select is(private.formatted_text_plain(E'câș*b*'), E'câș*b*', 'diacritic before marker');
select is(private.formatted_text_plain(E'~~vechi~~ ~tăiat~ ==nou=='), E'vechi tăiat nou', 'strike and highlight');
select is(private.formatted_text_plain(E'# Titlu\n## Sub\n### Mic'), E'Titlu\nSub\nMic', 'headings');
select is(private.formatted_text_plain(E'> citat'), E'citat', 'quote');
select is(private.formatted_text_plain(E'- unu\n  - doi\n1. trei'), E'• unu\n  • doi\n1. trei', 'lists');
select is(private.formatted_text_plain(E'[formularul](https://forms.gle/x) și https://osubb.ro'), E'formularul și https://osubb.ro', 'links');
select is(private.formatted_text_plain(E'[rău](javascript:alert(1))'), E'[rău](javascript:alert(1))', 'unsafe link stays text');
select is(private.formatted_text_plain(E'\\*nu\\* \\# titlu'), E'*nu* # titlu', 'escapes');
select is(private.formatted_text_plain(E'rând\r\n- punct'), E'rând\n• punct', 'crlf');
select is(private.formatted_text_plain(E'  - spațiu în față'), E'• spațiu în față', 'leading spaces');
select is(private.formatted_text_plain(E'<b>html</b>'), E'<b>html</b>', 'html stays text');
select is(private.formatted_text_plain(E'*a*b'), E'*a*b', 'closer before letter');
select is(private.formatted_text_plain(E'_a_b'), E'_a_b', 'underscore closer before letter');
select is(private.formatted_text_plain(E'câș_b_'), E'câș_b_', 'diacritic before underscore');
select is(private.formatted_text_plain(E'\\_nu\\_'), E'_nu_', 'escaped underscore');
select is(private.formatted_text_plain(E'\\~nu\\~'), E'~nu~', 'escaped tilde');
select is(private.formatted_text_plain(E'abc\n'), E'abc\n', 'trailing newline kept');
select is(private.formatted_text_plain(E'*a *'), E'a ', 'em space is not a space in a marker');
select is(private.formatted_text_plain(E'[x](https://a.ro/b c)'), E'x', 'em space is not a space in a link address');

-- ==================== contract ====================

select is(private.formatted_text_plain(null), null, 'null in, null out');
select is(
  (select p.provolatile::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'formatted_text_plain'),
  'i',
  'the stripper is immutable');
select ok(not has_function_privilege('authenticated', 'private.formatted_text_plain(text)', 'execute'),
  'authenticated cannot execute the stripper directly');

select * from finish();
rollback;
