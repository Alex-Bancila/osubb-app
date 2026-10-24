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

select plan(67);

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
select is(private.formatted_text_plain(E'> # Titlu'), E'Titlu', 'quoted heading');
select is(private.formatted_text_plain(E'# > x'), E'> x', 'heading holding a quote mark');
select is(private.formatted_text_plain(E'2 ** 3 ** 4'), E'2 ** 3 ** 4', 'spaced stars stay');
select is(private.formatted_text_plain(E'a == b == c'), E'a == b == c', 'spaced equals stay');
select is(private.formatted_text_plain(E'**a **'), E'**a **', 'bold needs an edge');
select is(private.formatted_text_plain(E'[a [b](https://x.ro)'), E'[a b', 'innermost link');
select is(private.formatted_text_plain(E'\\<div>Sala</div> la 18'), E'<div>Sala</div> la 18', 'escaped line-start tag');
select is(private.formatted_text_plain(E'vezi ftp\\://x.ro/*a*/b'), E'vezi ftp://x.ro/a/b', 'escaped colon');
select is(private.formatted_text_plain(E'a \\$ x \\" x \\@ x \\? x \\& x \\% x \\, x \\; x \\/ x \\^ x \\'' x'), E'a $ x " x @ x ? x & x % x , x ; x / x ^ x '' x', 'every ascii punctuation escape');
select is(private.formatted_text_plain(E'a \\é x \\1 x'), E'a \\é x \\1 x', 'backslash before a letter or digit stays');
select is(private.formatted_text_plain(E'> > citat în citat'), E'citat în citat', 'quote in a quote');
select is(private.formatted_text_plain(E'>> q'), E'q', 'quote markers run together');
select is(private.formatted_text_plain(E'> - a'), E'• a', 'list in a quote');
select is(private.formatted_text_plain(E'- > q'), E'• q', 'quote opens an item');
select is(private.formatted_text_plain(E'1. > q'), E'1. q', 'quote opens a numbered item');
select is(private.formatted_text_plain(E'- - a'), E'• • a', 'nested list on the item line');
select is(private.formatted_text_plain(E'* + a'), E'• • a', 'nested list with other bullets');
select is(private.formatted_text_plain(E'1. - a'), E'1. • a', 'bullet inside a numbered item');
select is(private.formatted_text_plain(E'- \\- a'), E'• - a', 'escaped marker inside an item');
select is(private.formatted_text_plain(E'- # x'), E'• x', 'heading opens an item');
select is(private.formatted_text_plain(E'- #hashtag'), E'• #hashtag', 'hashtag in an item is not a heading');
select is(private.formatted_text_plain(E'1.\n   ## x'), E'1. x', 'heading on the next line of a numbered item');
select is(private.formatted_text_plain(E'3.\n   > # a'), E'3. a', 'quoted heading on the next line of an item');
select is(private.formatted_text_plain(E'-\n  - a'), E'• • a', 'item opens on the next line');
select is(private.formatted_text_plain(E'-\n  > q'), E'• q', 'item opens with a quote on the next line');
select is(private.formatted_text_plain(E'1.\n   > q'), E'1. q', 'numbered item opens on the next line');
select is(private.formatted_text_plain(E'-\n  - a\n-\n  - b'), E'• • a\n• • b', 'items opening on the next line, one after another');
select is(private.formatted_text_plain(E'-\n  -\n    - a'), E'• • • a', 'item opens on the next line twice');
select is(private.formatted_text_plain(E'-\n a'), E'-\n a', 'too little indent is not item content');
select is(private.formatted_text_plain(E'a\n-\n  b'), E'a\n-\n  b', 'setext underline is not an item');
select is(private.formatted_text_plain(E'> -\n>   1. x'), E'• 1. x', 'item in a quote opens on the next line');
select is(private.formatted_text_plain(E'> - > q'), E'• q', 'quote in an item in a quote');
select is(private.formatted_text_plain(E'- > # x'), E'• x', 'quoted heading opens an item');
select is(private.formatted_text_plain(E'# Titlu\n-\n  a'), E'Titlu\n• a', 'item after a heading opens on the next line');
select is(private.formatted_text_plain(E'> a\n-\n  b'), E'a\n• b', 'item after a quote opens on the next line');
select is(private.formatted_text_plain(E'> a\n> -\n>   b'), E'a\n-\n  b', 'setext underline inside a quote is not an item');
select is(private.formatted_text_plain(E'---\n-\n  a'), E'---\n• a', 'item after a thematic break opens on the next line');
select is(private.formatted_text_plain(E'> - - -'), E'- - -', 'quoted thematic break stays as typed');
select is(private.formatted_text_plain(E'- - -'), E'- - -', 'thematic break stays as typed');
select is(private.formatted_text_plain(E'* * *'), E'* * *', 'starred thematic break stays as typed');

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

-- #1109: the block steps run once per line, each anchored at its start, so a
-- long run of markers strips in one pass (about a millisecond on 4000
-- characters; the bound leaves room for a slow runner).
create function pg_temp.slowest_strip_ms() returns numeric
language plpgsql as $$
declare
  v_input text;
  v_start timestamptz;
  v_slowest numeric := 0;
  v_words text;
begin
  foreach v_input in array array[
    repeat('>', 4000),
    repeat('- ', 2000),
    repeat(chr(92), 4000),
    repeat('-' || chr(10) || '  ', 1000)
  ] loop
    v_start := clock_timestamp();
    v_words := private.formatted_text_plain(v_input);
    v_slowest := greatest(v_slowest, extract(epoch from clock_timestamp() - v_start) * 1000);
  end loop;
  return v_slowest;
end;
$$;
select cmp_ok(pg_temp.slowest_strip_ms(), '<', 50::numeric,
  'a 4000-character run of quote or list markers, backslashes or items opening on the next line strips in under 50 ms');

select * from finish();
rollback;
