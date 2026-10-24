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

/**
 * The characters a single-character marker may not touch (`5*3*2` is text),
 * as a character-class body. The reader (`lex.ts`) escapes with the same class.
 */
export const WORD = '0-9A-Za-z\\u00C0-\\u024F';
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

/** A list marker: a bullet, or one to nine digits and `.` or `)`. */
const MARKER = '(?:[-*+]|[0-9]{1,9}[.)])';

/** A line of list markers alone: an item whose words start on the next line. */
const BARE_MARKERS = new RegExp(
  `^[ \\t]*(?:${MARKER}[ \\t]+)*${MARKER}[ \\t]*$`,
  'u',
);

/**
 * What may come before a line of markers alone (in the same quote) for it to
 * open a list item: a blank line, an indented one, an item, a heading or a
 * thematic break. After a line of text a bare `-` is a setext underline, which
 * the reader shows as typed.
 */
const ITEM_MAY_FOLLOW = new RegExp(
  `^(?:[ \\t]*$|[ \\t]|${MARKER}(?:[ \\t]|$)|#{1,6}(?:[ \\t]|$)|([-*_])[ \\t]*(?:\\1[ \\t]*){2,}$)`,
  'u',
);

/** A line's leading quote markers, with the space after the last. */
const QUOTE_RUN = /^[ \t]*>(?:[ \t]*>)*[ \t]?/u;

/** One quote marker at a line start, with the space after it. */
const ONE_QUOTE = /^[ \t]*>[ \t]?/u;

/**
 * A line's leading list and quote markers, each with the spaces after it, as
 * a quote inside an item interleaves them: `- > 1. `.
 */
const LEADING_MARKERS = new RegExp(
  `^[ \\t]*(?:${MARKER}[ \\t]+|>[ \\t]*)*`,
  'u',
);

/** A heading's marker, once the line's leading markers are off. */
const HEADING_MARKER = /^#{1,6}[ \t]+/u;

/** `---`, `- - -`, `***`: a thematic break, which the reader shows as typed. */
const THEMATIC_BREAK = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/u;

/** How many quotes `line` opens with. */
function quoteDepth(line: string): number {
  return (QUOTE_RUN.exec(line)?.[0] ?? '').split('>').length - 1;
}

/** `line` without its leading quote markers. */
function unquoted(line: string): string {
  return line.slice(QUOTE_RUN.exec(line)?.[0].length ?? 0);
}

/** `line` without `depth` leading quote markers, or `null` if it has fewer. */
function withoutQuotes(line: string, depth: number): string | null {
  let rest = line;
  for (let quote = 0; quote < depth; quote += 1) {
    const marker = ONE_QUOTE.exec(rest)?.[0];
    if (marker === undefined) return null;
    rest = rest.slice(marker.length);
  }
  return rest;
}

/** How many spaces and tabs `line` starts with. */
function indentOf(line: string): number {
  let indent = 0;
  while (line[indent] === ' ' || line[indent] === '\t') indent += 1;
  return indent;
}

/** `rtrim(line, ' \t')`: trailing spaces and tabs off. */
function trimEndSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  return line.slice(0, end);
}

/** Whether `next` holds words indented past `markers`: that item's content. */
function isItemContent(markers: string, next: string): boolean {
  const indent = indentOf(next);
  return indent < next.length && indent > trimEndSpaces(markers).length;
}

/**
 * A line's leading markers off: its quote markers, a heading's marker after
 * them, and each bullet among them as `•` (a numbered item keeps its number).
 */
function leadingMarkersOff(line: string): string {
  const run = LEADING_MARKERS.exec(line)?.[0] ?? '';
  const words = line.slice(run.length).replace(HEADING_MARKER, '');
  return run.replace(/>[ \t]*/gu, '').replace(/[-*+][ \t]+/gu, '• ') + words;
}

/**
 * The block markers off, line by line, as the database's loop does them. A
 * line's quote markers go first, so `> # Titlu` loses both. A line of markers
 * alone (`-`, or `1.`) is then joined to the words on the next line of the
 * same quote when they are indented past it, as the reader reads them: an
 * item that opens with a quote, a heading or a nested list is written that
 * way. Then the line's leading markers go (see `leadingMarkersOff`); a
 * thematic break stays as typed.
 */
function blockMarkersOff(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    const depth = quoteDepth(line);
    let body = unquoted(line);
    const before = lines[at - 1];
    if (
      before === undefined ||
      quoteDepth(before) !== depth ||
      ITEM_MAY_FOLLOW.test(unquoted(before))
    ) {
      while (
        BARE_MARKERS.test(body) &&
        !THEMATIC_BREAK.test(body) &&
        at + 1 < lines.length
      ) {
        const next = withoutQuotes(lines[at + 1] ?? '', depth);
        if (next === null || !isItemContent(body, next)) break;
        at += 1;
        body = `${trimEndSpaces(body)} ${next.slice(indentOf(next))}`;
      }
    }
    out.push(THEMATIC_BREAK.test(body) ? body : leadingMarkersOff(body));
  }
  return out.join('\n');
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
  let text = blockMarkersOff(markdown.replace(/\r\n/g, '\n'));
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
  // Every ASCII punctuation character, as CommonMark and the reader unescape.
  text = text.replace(/\\([!-/:-@[-`{-~])/gu, '$1');
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
