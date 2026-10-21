import {
  Marked,
  type Token,
  type TokenizerExtension,
  type Tokens,
} from 'marked';

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
 *   - a single `*` or `~` between two letters or digits is text (`5*3*2`,
 *     `5~10 și 20~30`), escaped before lexing; `_` inside a word is already
 *     text in CommonMark (`nume_prenume`);
 *   - `**`, `~~` and `==` pair only around words (`2 ** 3 ** 4` is text);
 *   - in `[a [b](https://x.ro)` the innermost brackets are the link.
 */

/** `==x==`: the words start and end on a non-space, so `a == b == c` is text. */
const HIGHLIGHT = /^==(?=\S)([\s\S]*?\S)==/;

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

/** A single `*` or `~` between two letters or digits: text, not a marker. */
const INTRAWORD_MARKER = /(?<=[\p{L}\p{N}])[*~](?=[\p{L}\p{N}])/gu;

/** The escape `INTRAWORD_MARKER` added, wherever a token keeps its source. */
const ADDED_ESCAPE = /(?<=[\p{L}\p{N}])\\([*~])(?=[\p{L}\p{N}])/gu;

function withoutAddedEscapes(value: string): string {
  return value.replace(ADDED_ESCAPE, '$1');
}

/**
 * Every token's `raw` back as it was typed, since the reader shows the `raw` of
 * whatever is outside the dialect. A bare address is read with no escapes in
 * it, so its address and words get the same treatment.
 */
function restoreSource(tokens: readonly Token[]): void {
  for (const token of tokens as Tokens.Generic[]) {
    token.raw = withoutAddedEscapes(token.raw);
    if (token.type === 'link' && !token.raw.startsWith('[')) {
      token.href = withoutAddedEscapes(token.href);
      token.text = withoutAddedEscapes(token.text);
      for (const child of token.tokens ?? [])
        if (child.type === 'text') child.text = withoutAddedEscapes(child.text);
    }
    restoreSource(token.tokens ?? []);
    if (token.type === 'list') restoreSource(token.items);
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
 * folded to `\n` and a single `*` or `~` inside a word is escaped first; the
 * tokens come back with their `raw` as typed, checklist boxes as text, and
 * each run of words in one `text` token. A highlight is a token of its own:
 * `{ type: 'highlight', raw, text, tokens }`.
 */
export function lexFormattedText(markdown: string): Token[] {
  const source = markdown
    .replace(/\r\n/g, '\n')
    .replace(INTRAWORD_MARKER, '\\$&');
  const tokens = joinText(reader.lexer(source));
  restoreSource(tokens);
  return tokens;
}
