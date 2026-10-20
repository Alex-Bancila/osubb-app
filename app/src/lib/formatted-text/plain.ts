import { charLength } from '../normalize';

/**
 * The words of a Formatted Text (ruling R60), a restricted Markdown. Step for
 * step the regexp chain of `private.formatted_text_plain`, so the length the
 * browser counts is the length the database counts; both are held to the
 * fixture lines of supabase/tests/formatted_text_plain.test.sql by
 * `plain.test.ts`. Change a step on one side and the other side follows in the
 * same commit.
 *
 * Where Postgres and JavaScript read a pattern differently, this one spells
 * out what Postgres does:
 *
 *   - a space is `[ \t\n\r\f\v]` here and in the database, not `\s` (which
 *     counts Unicode spaces) and not `[[:space:]]` (which does under some
 *     locales, U+2003 among them);
 *   - a word character is `0-9A-Za-z` and U+00C0-U+024F, every Romanian
 *     letter, not `\p{L}`;
 *   - the `n` flag, where `^` means "start of a line" and a negated class
 *     never crosses a newline, becomes `(^|\n)` (the `m` flag would also
 *     break a line at `\r`, U+2028 and U+2029) and a negated class that names
 *     `\n`;
 *   - `btrim` trims spaces only, where `String.prototype.trim` trims every kind
 *     of whitespace.
 */

/** The characters a single-character marker may not touch (`5*3*2` is text). */
const WORD = '0-9A-Za-z\\u00C0-\\u024F';
const SPACE = ' \\t\\n\\r\\f\\v';

/**
 * `marker` around words, only at a word boundary: not after a word character,
 * the same marker or a backslash, and not before a word character or the same
 * marker. The content starts and ends on a non-space. After a newline the
 * boundary is the newline itself (`^` in the database).
 */
function boundaryPair(marker: '*' | '_' | '~'): RegExp {
  const escaped = marker === '*' ? '\\*' : marker;
  return new RegExp(
    `(^|[^${WORD}${marker}\\\\])${escaped}` +
      `([^${marker}${SPACE}]([^${marker}\\n]*[^${marker}${SPACE}])?)` +
      `${escaped}(?![${WORD}${marker}])`,
    'gu',
  );
}

/**
 * `marker` doubled around words, anywhere on a line. The content starts and
 * ends on a non-space, so `2 ** 3 ** 4` and `a == b == c` are text.
 */
function doubledPair(marker: '*' | '~' | '='): RegExp {
  const escaped = marker === '*' ? '\\*\\*' : marker + marker;
  return new RegExp(
    `${escaped}([^${marker}${SPACE}]([^${marker}\\n]*[^${marker}${SPACE}])?)${escaped}`,
    'gu',
  );
}

const BOLD = doubledPair('*');
const STRIKE_DOUBLED = doubledPair('~');
const HIGHLIGHT = doubledPair('=');
const ITALIC_STAR = boundaryPair('*');
const ITALIC_UNDERSCORE = boundaryPair('_');
const STRIKE_TILDE = boundaryPair('~');

/** `btrim`: spaces only, from both ends (a loop, so a run of spaces stays linear). */
function trimSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ' ') start += 1;
  while (end > start && value[end - 1] === ' ') end -= 1;
  return value.slice(start, end);
}

/**
 * The Formatted Text without its markers: quote and heading markers removed,
 * list items bulleted (a numbered item keeps its number), paired
 * bold/italic/strike/highlight markers and http(s) Text Link syntax removed,
 * backslash escapes unescaped, CRLF folded to LF, trimmed of spaces. The order
 * is the database's: the quote before the heading, so `> # Titlu` loses both,
 * and the backslash escapes last. A backslash therefore keeps a marker literal
 * only where an earlier step refuses it (a line start, a single-marker opener,
 * a pair of stars written `\*\*`); the Text Link and the closers do not look
 * for one, so `\[x](https://a.b)` gives `\x` and `*a\*` gives `a\`.
 */
export function toPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n');
  text = text.replace(/(^|\n)[ \t]*>[ \t]?/gu, '$1');
  text = text.replace(/(^|\n)[ \t]*#{1,6}[ \t]+/gu, '$1');
  text = text.replace(/(^|\n)([ \t]*)[-*+][ \t]+/gu, '$1$2• ');
  // The words hold no bracket: the innermost one wins, as in CommonMark.
  text = text.replace(
    /\[([^[\]\n]*)\]\((https?:\/\/[^) \t\n\r\f\v]+)\)/gu,
    '$1',
  );
  text = text.replace(BOLD, '$1');
  text = text.replace(STRIKE_DOUBLED, '$1');
  text = text.replace(HIGHLIGHT, '$1');
  text = text.replace(ITALIC_STAR, '$1$2');
  text = text.replace(ITALIC_UNDERSCORE, '$1$2');
  text = text.replace(STRIKE_TILDE, '$1$2');
  text = text.replace(/\\([\\`*_{}[\]()#+.!~=>|-])/gu, '$1');
  return trimSpaces(text);
}

/**
 * How long a Formatted Text reads: the characters of its words, counted as
 * Postgres `char_length` counts them (see `charLength`), which is what the
 * database's visible-length limits measure.
 */
export function visibleLength(markdown: string): number {
  return charLength(toPlainText(markdown));
}
