-- #1109 (R60 follow-up): private.formatted_text_plain gives the words the
-- reader shows in more cases, found in the final review of the editor
-- (PR #1105):
--
--   1. Every ASCII punctuation escape is unescaped, as CommonMark and the
--      reader do. The editor writes `\<` before a line that would open an
--      HTML block and `ftp\:` when a marker sits in an ftp address; the old
--      class kept their backslash in a Notification and in the visible count.
--   2. Every quote marker of a line goes: `> > q` (a quote typed inside a
--      Citat) and `>> q`, not only the first.
--   3. Quote and heading markers after a line's list markers go too, and every
--      bullet among them becomes `•`: `- > q`, `1. > q`, `- # x`, `- - a`,
--      `> - > q`. A numbered item keeps its number.
--   4. An item whose words start on the next line, as the editor writes one
--      that opens with a quote, a heading or a nested list (`-\n  - a`,
--      `1.\n   > q`, `> -\n>   1. x`), is joined to them.
--
-- A thematic break (`- - -`, `* * *`) now stays as typed, as the reader shows
-- it, instead of losing its first marker to the bullet step.
--
-- The block steps become one pass over the lines: the join needs the line
-- before (after a line of text a bare `-` is a setext underline, not an item)
-- and the next line of the same quote. Each step is a pattern anchored at a
-- line start, so the pass stays linear on a 4000-character text. The inline
-- steps and their order are unchanged. The TypeScript twin (toPlainText)
-- changes step for step in the same commit, and both are tested against the
-- fixture lines of supabase/tests/formatted_text_plain.test.sql.
--
-- Rebuilt from its latest definition, 20261020213926_formatted_text.sql. Its
-- callers (require_formatted_text_length, notify_announcement,
-- event_announcement_body, create_event_impl) keep calling it as they did. No
-- stored text changes, and a visible length can only shrink.

create or replace function private.formatted_text_plain(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
  v_lines text[];
  v_out text[] := '{}'::text[];
  v_line text;
  v_before text;
  v_before_quotes text;
  v_quotes text;
  v_depth integer;
  v_body text;
  v_next text;
  v_marker text;
  v_run text;
  v_at integer := 1;
  v_count integer;
begin
  if p_text is null then
    return null;
  end if;

  v := replace(p_text, E'\r\n', E'\n');

  -- The block markers, line by line. A line's quote markers go first, so
  -- `> # Titlu` loses both. A line of list markers alone (`-`, `1.`) is then
  -- joined to the words on the next line of the same quote when they are
  -- indented past it -- unless the line before, in that quote, is text: then a
  -- bare `-` is a setext underline. Then the line's leading markers go: its
  -- quote markers among its list markers, a heading's marker after them, and
  -- each bullet becomes `•` (a numbered item keeps its number). A thematic
  -- break stays as typed.
  v_lines := string_to_array(v, E'\n');
  v_count := coalesce(array_length(v_lines, 1), 0);
  while v_at <= v_count loop
    v_line := v_lines[v_at];
    v_quotes := coalesce(substring(v_line from '^[ \t]*>(?:[ \t]*>)*[ \t]?'), '');
    v_depth := char_length(v_quotes) - char_length(replace(v_quotes, '>', ''));
    v_body := substr(v_line, char_length(v_quotes) + 1);

    v_before := v_lines[v_at - 1];
    v_before_quotes := coalesce(substring(v_before from '^[ \t]*>(?:[ \t]*>)*[ \t]?'), '');
    if v_before is null
       or char_length(v_before_quotes) - char_length(replace(v_before_quotes, '>', '')) <> v_depth
       or substr(v_before, char_length(v_before_quotes) + 1)
          ~ '^(?:[ \t]*$|[ \t]|(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)|#{1,6}(?:[ \t]|$)|([-*_])[ \t]*(?:\1[ \t]*){2,}$)' then
      while v_body ~ '^[ \t]*(?:(?:[-*+]|[0-9]{1,9}[.)])[ \t]+)*(?:[-*+]|[0-9]{1,9}[.)])[ \t]*$'
            and v_body !~ '^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$'
            and v_at < v_count loop
        -- The next line without this line's quote markers, if it has them.
        v_next := v_lines[v_at + 1];
        for v_quote in 1 .. v_depth loop
          v_marker := substring(v_next from '^[ \t]*>[ \t]?');
          if v_marker is null then
            v_next := null;
            exit;
          end if;
          v_next := substr(v_next, char_length(v_marker) + 1);
        end loop;
        exit when v_next is null
          or v_next !~ '^[ \t]*[^ \t]'
          or char_length(substring(v_next from '^[ \t]*')) <= char_length(rtrim(v_body, E' \t'));
        v_at := v_at + 1;
        v_body := rtrim(v_body, E' \t') || ' ' || ltrim(v_next, E' \t');
      end loop;
    end if;

    if v_body !~ '^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$' then
      v_run := coalesce(
        substring(v_body from '^[ \t]*(?:(?:[-*+]|[0-9]{1,9}[.)])[ \t]+|>[ \t]*)*'), '');
      v_body := regexp_replace(regexp_replace(v_run, '>[ \t]*', '', 'g'), '[-*+][ \t]+', '• ', 'g')
        || regexp_replace(substr(v_body, char_length(v_run) + 1), '^#{1,6}[ \t]+', '');
    end if;

    v_out := array_append(v_out, v_body);
    v_at := v_at + 1;
  end loop;
  v := array_to_string(v_out, E'\n');

  -- A Text Link shows its words; only http(s) is a link, so [x](javascript:..)
  -- stays text. Its words hold no bracket, so the innermost bracket wins
  -- (`[a [b](https://x.ro)` gives `[a b`, as in CommonMark) and a run of `[`
  -- is read once, not once per bracket.
  v := regexp_replace(v, '\[([^][\n]*)\]\((https?://[^) \t\n\r\f\v]+)\)', '\1', 'g');
  -- Paired markers, each around words that start and end on a non-space, so
  -- `2 ** 3 ** 4` and `a == b == c` stay as typed. The doubled ones pair
  -- anywhere on a line; the single ones only at a word boundary.
  v := regexp_replace(v, '\*\*([^* \t\n\r\f\v]([^*\n]*[^* \t\n\r\f\v])?)\*\*', '\1', 'g');
  v := regexp_replace(v, '~~([^~ \t\n\r\f\v]([^~\n]*[^~ \t\n\r\f\v])?)~~', '\1', 'g');
  v := regexp_replace(v, '==([^= \t\n\r\f\v]([^=\n]*[^= \t\n\r\f\v])?)==', '\1', 'g');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ*\\])\*([^* \t\n\r\f\v]([^*\n]*[^* \t\n\r\f\v])?)\*(?![0-9A-Za-zÀ-ɏ*])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ_\\])_([^_ \t\n\r\f\v]([^_\n]*[^_ \t\n\r\f\v])?)_(?![0-9A-Za-zÀ-ɏ_])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ~\\])~([^~ \t\n\r\f\v]([^~\n]*[^~ \t\n\r\f\v])?)~(?![0-9A-Za-zÀ-ɏ~])', '\1\2', 'gn');
  -- A backslash escape shows the escaped character: every ASCII punctuation
  -- character, as CommonMark and the reader unescape.
  v := regexp_replace(v, '\\([!-/:-@[-`{-~])', '\1', 'g');

  return btrim(v);
end;
$$;

comment on function private.formatted_text_plain(text) is
  'R60 (Formatted Text): the words of a restricted-Markdown text -- line by line, quote markers removed, an item whose words start on the next line of the same quote joined to them, a line''s leading list and quote markers and a heading marker after them removed (each bullet becomes a "•", a numbered item keeps its number, a thematic break stays as typed); then paired bold/italic/strike/highlight markers and http(s) Text Link syntax removed, and every ASCII punctuation escape unescaped last (so an escaped line-start marker, single-marker opener or pair of stars stays literal, while an escaped Text Link bracket or closing marker does not), CRLF folded to LF, trimmed. Null in, null out. The visible-length limits count its result and a Notification body carries it; the TypeScript twin toPlainText gives the same words, both tested against supabase/tests/formatted_text_plain.test.sql.';
revoke execute on function private.formatted_text_plain(text)
  from public, anon, authenticated, service_role;
