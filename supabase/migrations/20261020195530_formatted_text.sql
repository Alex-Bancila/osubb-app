-- R60: Formatted Text, the server's half.
--
-- Four fields carry a restricted Markdown (Announcement body, Task and Event
-- description, Group description). The database never renders it; it only
-- needs the words, so the visible-length limits count them and a Notification
-- carries them. The sections below build that in the order the later ones use:
--
--   1. private.formatted_text_plain, the stripper.

-- ==================== 1. private.formatted_text_plain (R60) ====================

-- Markdown in, plain words out. A regexp chain whose order matters: block
-- markers first (they are anchored at a line start), then links and the paired
-- inline markers, and the backslash escapes last so an escaped marker survives
-- every pattern before it. Each pattern that anchors on `^` runs newline-
-- sensitive ('n'), so `^` means the start of a line and a bracket expression
-- never crosses one. The single-character markers (`*`, `_`, `~`) only pair at
-- a word boundary, so `5*3*2`, `nume_prenume` and `ăla*b*` stay as typed; a
-- word character is spelled out as 0-9, A-Z, a-z and U+00C0-U+024F (every
-- Romanian letter) rather than [[:alnum:]], so the result never depends on the
-- database locale and the TypeScript twin spells the same class. The
-- TypeScript twin (toPlainText) runs the same chain, and both are tested
-- against the fixture lines of supabase/tests/formatted_text_plain.test.sql.
create function private.formatted_text_plain(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;

  v := replace(p_text, E'\r\n', E'\n');
  -- Headings and quotes lose their marker; list markers become a bullet
  -- (a numbered item keeps its number).
  v := regexp_replace(v, '^[ \t]*#{1,6}[ \t]+', '', 'gn');
  v := regexp_replace(v, '^[ \t]*>[ \t]?', '', 'gn');
  v := regexp_replace(v, '^([ \t]*)[-*+][ \t]+', '\1• ', 'gn');
  -- A Text Link shows its words; only http(s) is a link, so [x](javascript:..)
  -- stays text.
  v := regexp_replace(v, '\[([^]\n]*)\]\((https?://[^)[:space:]]+)\)', '\1', 'g');
  -- Paired markers. The doubled ones pair anywhere on a line; the single
  -- ones only at a word boundary.
  v := regexp_replace(v, '\*\*([^*\n]+)\*\*', '\1', 'g');
  v := regexp_replace(v, '~~([^~\n]+)~~', '\1', 'g');
  v := regexp_replace(v, '==([^=\n]+)==', '\1', 'g');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ*\\])\*([^*[:space:]]([^*\n]*[^*[:space:]])?)\*(?![0-9A-Za-zÀ-ɏ*])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ_\\])_([^_[:space:]]([^_\n]*[^_[:space:]])?)_(?![0-9A-Za-zÀ-ɏ_])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ~\\])~([^~[:space:]]([^~\n]*[^~[:space:]])?)~(?![0-9A-Za-zÀ-ɏ~])', '\1\2', 'gn');
  -- A backslash escape shows the escaped character.
  v := regexp_replace(v, '\\([\\`*_{}\[\]()#+.!~=>|-])', '\1', 'g');

  return btrim(v);
end;
$$;

comment on function private.formatted_text_plain(text) is
  'R60 (Formatted Text): the words of a restricted-Markdown text -- heading, quote and list markers, paired bold/italic/strike/highlight markers and http(s) Text Link syntax removed, list items bulleted, backslash escapes unescaped, CRLF folded to LF, trimmed. Null in, null out. The visible-length limits count its result and a Notification body carries it; the TypeScript twin toPlainText gives the same words, both tested against supabase/tests/formatted_text_plain.test.sql.';
revoke execute on function private.formatted_text_plain(text)
  from public, anon, authenticated, service_role;
