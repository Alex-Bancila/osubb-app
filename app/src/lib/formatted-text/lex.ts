import {
  Marked,
  type Token,
  type TokenizerExtension,
  type Tokens,
} from 'marked';
import { WORD } from './plain';

/**
 * The tokens of a Formatted Text (ruling R60), read by `FormattedText`. One
 * `marked` instance with GitHub's dialect (strikethrough, bare addresses) and
 * a single line break as a hard break, plus `==highlight==`. The reader maps
 * these tokens to React elements and never asks `marked` for HTML, which it
 * would write with `<script>` and `javascript:` intact.
 *
 * Where the reader and the stripper (`plain.ts`, `private.formatted_text_plain`)
 * must agree on what is a marker:
 *
 *   - a single `*` or `~` between two of the stripper's word characters
 *     (`WORD`: digits, Latin letters and U+00C0–U+024F, every Romanian letter)
 *     is text (`5*3*2`, `5~10 și 20~30`), escaped before lexing; `_` inside a
 *     word is already text in CommonMark (`nume_prenume`);
 *   - `**`, `~~` and `==` pair only around words (`2 ** 3 ** 4` is text),
 *     and `==` only within one line with no `=` inside;
 *   - in `[a [b](https://x.ro)` the innermost brackets are the link.
 */

/**
 * `==x==`, paired exactly as the stripper pairs it (`plain.ts`, ruling 15): on
 * one line, no `=` inside, and a non-space just inside each marker, a space
 * being ` \t\n\r\f\v` as in the database. `a == b == c`, `==a=b==` and a pair
 * across a line break are text.
 */
const HIGHLIGHT = /^==([^= \t\n\r\f\v](?:[^=\n]*[^= \t\n\r\f\v])?)==/;

const highlight: TokenizerExtension = {
  name: 'highlight',
  level: 'inline',
  // Where plain text has to stop for a highlight to be tried (−1: nowhere).
  start: (src) => src.indexOf('=='),
  tokenizer(src) {
    const match = HIGHLIGHT.exec(src);
    if (!match) return undefined;
    const text = match[1] ?? '';
    return {
      type: 'highlight',
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text),
    };
  },
};

const reader = new Marked({ gfm: true, breaks: true, extensions: [highlight] });

/** A single `*` or `~` between two word characters: text, not a marker. */
const INTRAWORD_MARKER = new RegExp(`(?<=[${WORD}])[*~](?=[${WORD}])`, 'gu');

/** The escape `INTRAWORD_MARKER` added, wherever a token keeps its source. */
const ADDED_ESCAPE = new RegExp(`(?<=[${WORD}])\\\\([*~])(?=[${WORD}])`, 'gu');

function withoutAddedEscapes(value: string): string {
  return value.replace(ADDED_ESCAPE, '$1');
}

/**
 * How deep quotes and lists may nest (ruling 16). `marked` recurses once per
 * level, so a line of 2000 `>` (within every limit) would overflow the stack;
 * past this depth a line's markers are text.
 */
const MAX_DEPTH = 8;

/** A quote, bullet or number opening a container, with the spaces around it. */
const CONTAINER = /^[ \t]*(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))[ \t]?/;

/** A rule (`- - -`, `***`): no container, and left as it is. */
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** The escape `capNesting` puts on a marker: `\>`, `\-`, `\*`, `\+`, `1\.`. */
const CAP_ESCAPE = /^[ \t]*(?:\\[>*+-]|\d{1,9}\\[.)])/;

/** The container marker `rest` opens with, or `null`. */
function containerAt(rest: string): string | null {
  return RULE.test(rest) ? null : (CONTAINER.exec(rest)?.[0] ?? null);
}

/**
 * `line` with the container past `MAX_DEPTH` turned into text: its marker is
 * escaped, so `marked` opens nothing deeper and the rest reads as words.
 */
function capNesting(line: string): string {
  let at = 0;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const marker = containerAt(line.slice(at));
    if (!marker) return line;
    at += marker.length;
  }
  const marker = containerAt(line.slice(at));
  if (!marker) return line;
  const cut = at + marker.search(/[>*+.)-]/);
  return `${line.slice(0, cut)}\\${line.slice(cut)}`;
}

/**
 * `capNesting` undone in a token's source, line by line: the escape it put
 * after at most `MAX_DEPTH` markers (a nested token's source has lost the
 * markers of the containers around it).
 */
function uncapNesting(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let at = 0;
      for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
        const escape = CAP_ESCAPE.exec(line.slice(at));
        if (escape) {
          const cut = at + escape[0].indexOf('\\');
          return line.slice(0, cut) + line.slice(cut + 1);
        }
        const marker = containerAt(line.slice(at));
        if (!marker) return line;
        at += marker.length;
      }
      return line;
    })
    .join('\n');
}

/**
 * Every token's `raw` back as it was typed, since the reader shows the `raw` of
 * whatever is outside the dialect. A bare address is read with no escapes in
 * it, so its address and words get the same treatment. The nesting escapes are
 * undone only when `capNesting` changed a line, so a text nested no deeper than
 * the cap keeps every escape its writer typed.
 */
function restoreSource(tokens: readonly Token[], capped: boolean): void {
  for (const token of tokens as Tokens.Generic[]) {
    token.raw = withoutAddedEscapes(
      capped ? uncapNesting(token.raw) : token.raw,
    );
    if (token.type === 'link' && !token.raw.startsWith('[')) {
      token.href = withoutAddedEscapes(token.href);
      token.text = withoutAddedEscapes(token.text);
      for (const child of token.tokens ?? [])
        if (child.type === 'text') child.text = withoutAddedEscapes(child.text);
    }
    restoreSource(token.tokens ?? [], capped);
    if (token.type === 'list') restoreSource(token.items, capped);
  }
}

/**
 * Checklists are not part of the dialect (R60, decision 3): a list item's
 * `[ ] ` or `[x] ` is read back as the text it was typed as.
 */
function boxAsText(item: Tokens.ListItem): void {
  const [box, next] = item.tokens;
  if (box?.type !== 'checkbox') return;
  const text: Tokens.Text = { type: 'text', raw: box.raw, text: box.raw };
  if (next && 'tokens' in next && next.tokens) {
    next.tokens.unshift(text);
    item.tokens.shift();
  } else item.tokens[0] = { ...text, tokens: [{ ...text }] };
}

/** Plain words with no children: inline text, or a backslash escape. */
function isPlainText(token: Token): token is Tokens.Text | Tokens.Escape {
  return (token.type === 'text' && !token.tokens) || token.type === 'escape';
}

/**
 * Each run of plain words as one `text` token, escapes included, so `5*3*2`
 * (escaped to `5\*3\*2`) is one token reading `5*3*2`, as `\*nu\*` is one
 * reading `*nu*`. Children first.
 */
function joinText(tokens: Token[]): Token[] {
  const joined: Token[] = [];
  for (const token of tokens) {
    if (token.type === 'list')
      for (const item of (token as Tokens.List).items) {
        boxAsText(item);
        item.tokens = joinText(item.tokens);
      }
    else if ('tokens' in token && token.tokens)
      token.tokens = joinText(token.tokens);
    const last = joined.at(-1);
    if (!isPlainText(token)) joined.push(token);
    else if (last && isPlainText(last))
      joined[joined.length - 1] = {
        type: 'text',
        raw: last.raw + token.raw,
        text: last.text + token.text,
      };
    else joined.push({ type: 'text', raw: token.raw, text: token.text });
  }
  return joined;
}

/**
 * The block tokens of `markdown`, Formatted Text (ruling R60). Line ends are
 * folded to `\n`, each line's quotes and lists are capped at `MAX_DEPTH`, and
 * a single `*` or `~` inside a word is escaped first; the tokens come back
 * with their `raw` as typed, checklist boxes as text, and each run of words in
 * one `text` token. A highlight is a token of its own:
 * `{ type: 'highlight', raw, text, tokens }`.
 */
export function lexFormattedText(markdown: string): Token[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const capped = lines.map(capNesting);
  const source = capped.join('\n').replace(INTRAWORD_MARKER, '\\$&');
  const tokens = joinText(reader.lexer(source));
  restoreSource(
    tokens,
    capped.some((line, index) => line !== lines[index]),
  );
  return tokens;
}
