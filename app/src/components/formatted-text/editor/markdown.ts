import type { JSONContent } from '@tiptap/core';
import type { MarkedToken, Token, Tokens } from 'marked';
import {
  isDialectHeading,
  isWrittenTextLink,
} from '../../../lib/formatted-text/dialect';
import { lexFormattedText } from '../../../lib/formatted-text/lex';
import { toPlainText } from '../../../lib/formatted-text/plain';
import { safeHttpUrl } from '../../../lib/links';

/**
 * The editor's Markdown (ruling R60, ruling 21): the one dialect the reader
 * (`FormattedText`, through `lexFormattedText`) and the stripper (`toPlainText`,
 * `private.formatted_text_plain`) read, in both directions.
 *
 * Reading uses the reader's own tokens and maps them as `FormattedText` does,
 * so the editor opens a text exactly as the reader shows it. A single line
 * break is a hard break. Whatever is outside the dialect (raw HTML, code,
 * tables, images, a refused link) comes in as the words it was typed as.
 *
 * Writing starts from the document normalised (`normalizeFormattedText`) and
 * is checked three times:
 *
 *   - each line is read back by the reader's lexer and by the stripper and
 *     kept only when both read its words and marks; where the dialect cannot
 *     hold a mark there (italic inside a word, bold around a literal `*`), the
 *     mark comes off the fewest characters that make the two agree;
 *   - each paragraph is read back whole, since `marked` can pair a marker on
 *     one line with one on the next;
 *   - the whole document is read back, since a block can change the one after
 *     it.
 *
 * Where a check fails, that part is written plainer: its marks dropped and
 * its links kept, then every punctuation mark escaped. A line's search reads
 * back at most `LINE_CHECKS` ways before it settles for its links only
 * (ruling 27), since the editor writes the whole text on every change. What
 * is written is always what the reader shows, and writing it again gives the
 * same text. No mark spans a hard break: each line closes its marks, so
 * `**a**\n**b**`, never `**a\nb**`.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

/** One character of a line (a code point), with its marks by key. */
type Char = { text: string; marks: Map<string, Mark> };
type Line = Char[];

const STYLES = new Set(['bold', 'italic', 'strike', 'highlight']);

/** The inline order of opening, outermost first, for runs of equal length. */
const RANK = ['link', 'bold', 'strike', 'highlight', 'italic'];

const LINK = 'link ';

/**
 * A Text Link's address as it is written and kept: parentheses encoded, since
 * the stripper's Text Link ends at the first `)`.
 */
function writtenHref(href: string): string {
  return href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** A mark of the dialect, by key (a link's key holds its address), or `null`. */
function keyed(mark: Mark): [string, Mark] | null {
  if (mark.type === 'link') {
    const address =
      typeof mark.attrs?.href === 'string'
        ? safeHttpUrl(mark.attrs.href)
        : null;
    if (!address) return null;
    const href = writtenHref(address);
    return [LINK + href, { type: 'link', attrs: { href } }];
  }
  return STYLES.has(mark.type) ? [mark.type, { type: mark.type }] : null;
}

function linkMark(href: string): [string, Mark] {
  return [LINK + href, { type: 'link', attrs: { href } }];
}

function rank(key: string): number {
  return RANK.indexOf(key.startsWith(LINK) ? 'link' : key);
}

/* ------------------------------------------------------------------------ */
/* Nodes and lines: the shapes both directions build                         */
/* ------------------------------------------------------------------------ */

const paragraphNode = (content: JSONContent[] = []): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

const headingNode = (level: number, content: JSONContent[]): JSONContent => ({
  type: 'heading',
  attrs: { level: level === 1 ? 1 : 2 },
  content,
});

const quoteNode = (content: JSONContent[]): JSONContent => ({
  type: 'blockquote',
  content,
});

const itemNode = (content: JSONContent[]): JSONContent => ({
  type: 'listItem',
  content,
});

function listNode(
  ordered: boolean,
  start: number,
  content: JSONContent[],
): JSONContent {
  return ordered
    ? { type: 'orderedList', attrs: { start }, content }
    : { type: 'bulletList', content };
}

const isList = (node: JSONContent) =>
  node.type === 'bulletList' || node.type === 'orderedList';

/** Inline content as lines of characters, split at every hard break. */
function linesOf(content: readonly JSONContent[]): Line[] {
  const lines: Line[] = [[]];
  for (const node of content) {
    if (node.type === 'hardBreak') {
      lines.push([]);
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const marks = new Map<string, Mark>();
    for (const mark of node.marks ?? []) {
      const entry = keyed(mark as Mark);
      if (entry) marks.set(...entry);
    }
    for (const character of node.text) {
      if (character === '\n') lines.push([]);
      else lines.at(-1)?.push({ text: character, marks: new Map(marks) });
    }
  }
  return lines;
}

const SPACE = /\s/u;
const BLANK = /[ \t]/;

/** Every run of `key` in `line`, as `[start, end)`. */
function runsOf(line: Line, key: string): [number, number][] {
  const runs: [number, number][] = [];
  line.forEach((character, index) => {
    if (!character.marks.has(key)) return;
    const last = runs.at(-1);
    if (last && last[1] === index) last[1] = index + 1;
    else runs.push([index, index + 1]);
  });
  return runs;
}

function keysOf(line: Line): string[] {
  return [...new Set(line.flatMap((character) => [...character.marks.keys()]))];
}

function copied(line: Line): Line {
  return line.map((character) => ({
    text: character.text,
    marks: new Map(character.marks),
  }));
}

/**
 * `line` as the reader reads it back: no spaces or tabs at either end (the
 * reader drops them, and four would open a code block), and no space at the
 * edge of a mark (CommonMark closes no mark next to a space), so a mark over
 * spaces only is no mark.
 */
function normalized(line: Line): Line {
  let start = 0;
  let end = line.length;
  while (start < end && BLANK.test(line[start]?.text ?? '')) start += 1;
  while (end > start && BLANK.test(line[end - 1]?.text ?? '')) end -= 1;
  const characters = copied(line.slice(start, end));
  for (const key of keysOf(characters))
    for (const [from, to] of runsOf(characters, key)) {
      let first = from;
      let last = to;
      while (first < last && SPACE.test(characters[first]?.text ?? ''))
        characters[first++]?.marks.delete(key);
      while (last > first && SPACE.test(characters[last - 1]?.text ?? ''))
        characters[--last]?.marks.delete(key);
    }
  return characters;
}

function sameKeys(
  a: ReadonlyMap<string, unknown>,
  b: ReadonlyMap<string, unknown>,
) {
  return a.size === b.size && [...a.keys()].every((key) => b.has(key));
}

/** Lines back as inline content: text nodes, a hard break between lines. */
function inlineOf(lines: readonly Line[]): JSONContent[] {
  const content: JSONContent[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    let run: { text: string; marks: Map<string, Mark> } | null = null;
    const flush = () => {
      if (!run) return;
      const marks = [...run.marks.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([, mark]) => mark);
      content.push(
        marks.length
          ? { type: 'text', text: run.text, marks }
          : { type: 'text', text: run.text },
      );
    };
    for (const character of line) {
      if (run && sameKeys(run.marks, character.marks))
        run.text += character.text;
      else {
        flush();
        run = { text: character.text, marks: character.marks };
      }
    }
    flush();
  });
  return content;
}

/**
 * Lines as the paragraphs the reader shows: the empty ones at either end
 * dropped, and an empty line between two others (a blank line in the
 * Markdown) starting a new paragraph.
 */
function paragraphsOfLines(lines: readonly Line[]): JSONContent[] {
  const groups: Line[][] = [[]];
  for (const line of lines) {
    const group = groups.at(-1) ?? [];
    if (line.length) group.push(line);
    else if (group.length) groups.push([]);
  }
  return groups
    .filter((group) => group.length)
    .map((group) => paragraphNode(inlineOf(group)));
}

function paragraphsOf(content: readonly JSONContent[]): JSONContent[] {
  return paragraphsOfLines(linesOf(content).map(normalized));
}

/* ------------------------------------------------------------------------ */
/* Reading: the reader's tokens, mapped as FormattedText maps them           */
/* ------------------------------------------------------------------------ */

/** Text as typed, as `FormattedText`'s `asTyped`: its lines, hard breaks between. */
function typed(raw: string, marks: readonly Mark[]): JSONContent[] {
  return words(raw.replace(/\n+$/, ''), marks);
}

function words(text: string, marks: readonly Mark[]): JSONContent[] {
  return text.split('\n').flatMap((line, index): JSONContent[] => {
    const node: JSONContent[] = line
      ? [
          marks.length
            ? { type: 'text', text: line, marks: [...marks] }
            : { type: 'text', text: line },
        ]
      : [];
    return index > 0 ? [{ type: 'hardBreak' }, ...node] : node;
  });
}

function inline(
  tokens: readonly Token[],
  marks: readonly Mark[],
): JSONContent[] {
  return tokens.flatMap((token): JSONContent[] => {
    if (token.type === 'highlight')
      return inline(token.tokens ?? [], [...marks, { type: 'highlight' }]);
    const span = token as MarkedToken;
    switch (span.type) {
      case 'text':
        return span.tokens
          ? inline(span.tokens, marks)
          : words(span.text, marks);
      case 'escape':
        return words(span.text, marks);
      case 'br':
        return [{ type: 'hardBreak' }];
      case 'strong':
        return inline(span.tokens, [...marks, { type: 'bold' }]);
      case 'em':
        return inline(span.tokens, [...marks, { type: 'italic' }]);
      case 'del':
        return inline(span.tokens, [...marks, { type: 'strike' }]);
      case 'link': {
        const href = isWrittenTextLink(span) ? safeHttpUrl(span.href) : null;
        if (href)
          return span.text.trim()
            ? inline(span.tokens, [...marks, { type: 'link', attrs: { href } }])
            : [];
        break;
      }
    }
    return typed(token.raw, marks);
  });
}

function heading(token: Tokens.Heading): JSONContent[] {
  const [line = []] = linesOf(inline(token.tokens, [])).map(normalized);
  return line.length ? [headingNode(token.depth, inlineOf([line]))] : [];
}

function list(token: Tokens.List): JSONContent {
  const items = token.items.map((item) => {
    const children = blocks(item.tokens);
    // An item opens with words; one that opens with a title or a quote opens
    // with an empty line, as it was written.
    if (children[0]?.type !== 'paragraph') children.unshift(paragraphNode());
    return itemNode(children);
  });
  const start = typeof token.start === 'number' ? token.start : 1;
  return listNode(token.ordered, start, items);
}

function blocks(tokens: readonly Token[]): JSONContent[] {
  return tokens.flatMap((token): JSONContent[] => {
    const block = token as MarkedToken;
    switch (block.type) {
      case 'space':
        return [];
      case 'paragraph':
        return paragraphsOf(inline(block.tokens, []));
      case 'heading':
        if (!isDialectHeading(block)) break;
        return heading(block);
      case 'blockquote': {
        const content = blocks(block.tokens);
        return content.length ? [quoteNode(content)] : [];
      }
      case 'list':
        return [list(block)];
      // A tight list item's words.
      case 'text':
        return paragraphsOf(inline(block.tokens ?? [block], []));
    }
    return paragraphsOf(typed(token.raw, []));
  });
}

/**
 * A Formatted Text as the editor's document, read as the reader reads it. A
 * text the reader cannot lex opens as typed, as the reader then shows it.
 */
export function parseFormattedText(markdown: string): JSONContent {
  let content: JSONContent[];
  try {
    content = blocks(lexFormattedText(markdown));
  } catch {
    content = paragraphsOf(words(markdown.replace(/\r\n/g, '\n'), []));
  }
  return {
    type: 'doc',
    content: content.length ? content : [paragraphNode()],
  };
}

/* ------------------------------------------------------------------------ */
/* Normalising: the document as it will be read back                         */
/* ------------------------------------------------------------------------ */

/**
 * GitHub's bare-address rule, as `marked` applies it: an address up to a
 * space or `<`, then trailing punctuation given back (`_backpedal`, repeated).
 */
const BARE_ADDRESS = /https?:\/\/(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/giu;
const BACKPEDAL =
  /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

/** Characters an address never holds unencoded, where a typed one ends. */
const ENDS_ADDRESS = /[[\]|`\\]/u;

function addressExtent(text: string): string {
  const cut = text.search(ENDS_ADDRESS);
  let extent = cut === -1 ? text : text.slice(0, cut);
  for (;;) {
    const next = BACKPEDAL.exec(extent)?.[0] ?? '';
    if (next === extent) return extent;
    extent = next;
  }
}

/** The longest start of an address as typed that `safeHttpUrl` accepts. */
function longestAddress(written: string): string | null {
  let extent = addressExtent(written);
  while (/^https?:\/\/[a-zA-Z0-9-]/i.test(extent)) {
    if (safeHttpUrl(extent)) return extent;
    // `http://y.ro:_=` is no address; `http://y.ro` is.
    const cut = extent.search(/[^\p{L}\p{N}][\p{L}\p{N}]*$/u);
    if (cut < 0) return null;
    extent = addressExtent(extent.slice(0, cut));
  }
  return null;
}

function stylesOf(character: Char | undefined): string[] {
  return [...(character?.marks.keys() ?? [])]
    .filter((key) => !key.startsWith(LINK))
    .sort();
}

/**
 * `line` with every unlinked address the reader would link given a Text Link
 * to itself (the dialect's bare-address rule, decision 6), so it is written as
 * one and the reader's link ends where the editor's does. An address ends
 * where its first character's marks do, and at the longest start
 * `safeHttpUrl` accepts; the words after it are searched again.
 */
function autolinked(line: Line): Line {
  const characters = copied(line);
  const linked = (index: number) =>
    [...(characters[index]?.marks.keys() ?? [])].some((key) =>
      key.startsWith(LINK),
    );
  const text = characters.map((character) => character.text);
  const joined = text.join('');
  // Where each character starts in `joined`, to map a match back and forth.
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    offsets.push(offset);
    offset += character.length;
  }
  offsets.push(offset);
  const finder = new RegExp(BARE_ADDRESS.source, 'giu');
  for (let match = finder.exec(joined); match; match = finder.exec(joined)) {
    finder.lastIndex = match.index + 1;
    const start = offsets.indexOf(match.index);
    if (start < 0 || linked(start)) continue;
    const limit = offsets.indexOf(match.index + match[0].length);
    const styles = stylesOf(characters[start]).join(' ');
    let end = start;
    while (
      end < limit &&
      !linked(end) &&
      stylesOf(characters[end]).join(' ') === styles
    )
      end += 1;
    const address = longestAddress(text.slice(start, end).join(''));
    if (!address) continue;
    const stop = start + [...address].length;
    const [key, mark] = linkMark(writtenHref(address));
    for (let index = start; index < stop; index += 1)
      characters[index]?.marks.set(key, mark);
    finder.lastIndex = offsets[stop] ?? joined.length;
  }
  return characters;
}

/**
 * `line` with its Text Links taken off any `[` or `]` in their words: the
 * stripper's Text Link holds no bracket, so `[PDF] Regulament` linked is
 * written `\[[PDF](…)\] [Regulament](…)`.
 */
function unbracketed(line: Line): Line {
  return line.map((character) => {
    if (character.text !== '[' && character.text !== ']') return character;
    const marks = new Map(
      [...character.marks].filter(([key]) => !key.startsWith(LINK)),
    );
    return { text: character.text, marks };
  });
}

/** A line of inline content as it is written. */
function prepared(line: Line): Line {
  return autolinked(normalized(unbracketed(normalized(line))));
}

function preparedLines(content: readonly JSONContent[]): Line[] {
  return linesOf(content).map(prepared);
}

function normalizedItem(item: JSONContent): JSONContent[] {
  const children = normalizedBlocks(item.content ?? []);
  if (!children.length) return [];
  if (children[0]?.type !== 'paragraph') children.unshift(paragraphNode());
  return [itemNode(children)];
}

function normalizedBlock(node: JSONContent): JSONContent[] {
  switch (node.type) {
    case 'paragraph':
      return paragraphsOfLines(preparedLines(node.content ?? []));
    case 'heading': {
      // A title is one line: a hard break inside it is a space.
      const line = prepared(
        linesOf(node.content ?? []).flatMap((part, index) =>
          index > 0
            ? [{ text: ' ', marks: new Map<string, Mark>() }, ...part]
            : part,
        ),
      );
      return line.length
        ? [headingNode(Number(node.attrs?.level), inlineOf([line]))]
        : [];
    }
    case 'blockquote': {
      const content = normalizedBlocks(node.content ?? []);
      return content.length ? [quoteNode(content)] : [];
    }
    case 'bulletList':
    case 'orderedList': {
      const items = (node.content ?? []).flatMap(normalizedItem);
      if (!items.length) return [];
      const ordered = node.type === 'orderedList';
      const start = Number(node.attrs?.start ?? 1);
      const fits =
        Number.isInteger(start) &&
        start >= 0 &&
        start + items.length - 1 <= 999_999_999;
      return [listNode(ordered, fits ? start : 1, items)];
    }
    default:
      return normalizedBlocks(node.content ?? []);
  }
}

/** Blocks normalised; two lists of one kind side by side read back as one. */
function normalizedBlocks(nodes: readonly JSONContent[]): JSONContent[] {
  const content: JSONContent[] = [];
  for (const node of nodes)
    for (const block of normalizedBlock(node)) {
      const last = content.at(-1);
      if (last && isList(block) && last.type === block.type)
        last.content = [...(last.content ?? []), ...(block.content ?? [])];
      else content.push(block);
    }
  return content;
}

/**
 * The document as Formatted Text holds it, before any mark the dialect cannot
 * hold is dropped:
 *
 *   - each line trimmed of spaces and tabs, no mark starting or ending on a
 *     space, empty lines at a paragraph's edges dropped, an empty line inside
 *     one splitting it;
 *   - empty paragraphs, titles, quotes, list items and lists dropped;
 *   - a hard break inside a title as a space, any level past 2 as a Subtitlu;
 *   - two lists of one kind side by side as one list;
 *   - a Text Link off any `[` or `]` in its words, a refused one dropped, its
 *     address's parentheses encoded, and every unlinked address the reader
 *     would link linked to itself.
 *
 * Writing it, reading it back and writing again give the same text.
 */
export function normalizeFormattedText(doc: JSONContent): JSONContent {
  const content = normalizedBlocks(doc.content ?? []);
  return {
    type: 'doc',
    content: content.length ? content : [paragraphNode()],
  };
}

/* ------------------------------------------------------------------------ */
/* Writing a line                                                           */
/* ------------------------------------------------------------------------ */

type Variant = {
  flipItalic: boolean;
  bareLinks: boolean;
  tags: boolean;
  ftp: boolean;
};

/**
 * The ways a line is tried, in order: italic as `*` or `_`, an address bare
 * or bracketed, and last with every `<` on the line that opens an HTML tag or
 * comment escaped, not only the one holding a marker (`<span class="a_b">`,
 * `<!-- … -->`): the reader shows raw HTML as typed, escapes and all, so a
 * marker inside one can only be written that way. The stripper then shows
 * those backslashes (`plain.ts` does not unescape `<`). Before the tags, an
 * `ftp://` address with its `:` escaped: `marked` reads one as an address
 * and the reader shows it as typed, so one that holds a marker (`ftp://x/a_b`)
 * would show its escapes. One that holds none is written as it is.
 */
const VARIANTS: readonly Variant[] = [
  { tags: false, ftp: false },
  { tags: false, ftp: true },
  { tags: true, ftp: true },
].flatMap(({ tags, ftp }) =>
  [true, false].flatMap((bareLinks) =>
    [false, true].map((flipItalic) => ({ flipItalic, bareLinks, tags, ftp })),
  ),
);

/** Always written escaped: the dialect reads each anywhere in a line. */
const ESCAPED = new Set(['\\', '*', '_', '~', '`', '[', ']', '|']);

/** What the stripper unescapes (`plain.ts`): any other escape stays visible. */
const UNESCAPED = new Set('\\`*_{}[]()#+.!~=>|-');

/**
 * At the start of a line, what would open a block: a Titlu, a quote, a list
 * item, a rule (`---`, `- - -`) or a heading's underline (`---`, `=`).
 */
const OPENS_BLOCK =
  /^(?:#{1,6}(?:[ \t]|$)|>|[-+](?:[ \t]|$)|-+[ \t]*$|-(?:[ \t]*-){2,}[ \t]*$|=+[ \t]*$)/;
const OPENS_NUMBERED = /^\d{1,9}(?=[.)](?:[ \t]|$))/;

/** An HTML block opening at the start of a line: `<div>`, `</p>`, `<!--`, `<?`. */
const OPENS_HTML = /^<[A-Za-z/!?]/;

/**
 * Where `marked` starts a bare address: `http://`, `https://` or `ftp://`
 * and a character of a host. The reader shows one it does not link (`ftp://`,
 * or an address `safeHttpUrl` refuses) as typed, escapes and all.
 */
const ADDRESS_START = /^(?:https?|ftp):\/\/[a-zA-Z0-9-]/i;
const WWW = /^www\.[a-zA-Z0-9-]/;

/** Each character of `line` as it is written, escaped where the dialect needs it. */
function escapedCharacters(
  line: Line,
  prefix: string,
  everything: boolean,
  { tags, ftp }: Pick<Variant, 'tags' | 'ftp'>,
): string[] {
  const characters = line.map((character) => character.text);
  if (everything)
    return characters.map((character) =>
      PUNCTUATION.test(character) ? `\\${character}` : character,
    );
  const linked = (index: number) =>
    [...(line[index]?.marks.keys() ?? [])].some((key) => key.startsWith(LINK));
  const written = characters.map((character, index) => {
    if (ESCAPED.has(character)) return `\\${character}`;
    // `==` opens a highlight; a single `=` is a word.
    if (
      character === '=' &&
      (characters[index - 1] === '=' || characters[index + 1] === '=')
    )
      return '\\=';
    // `\](` would end a Text Link for the stripper, which ignores escapes.
    if (character === '(' && characters[index - 1] === ']') return '\\(';
    return character;
  });
  // `marked` reads `www.` on as an address up to the next space, through any
  // marker after it, and the reader then shows all of it as typed: its dot
  // is escaped, which the stripper unescapes.
  characters.forEach((_, index) => {
    if (linked(index)) return;
    if (WWW.test(characters.slice(index, index + 5).join('')))
      written[index + 3] = '\\.';
  });
  // An address left unlinked (one `safeHttpUrl` refuses, or an `ftp://`
  // one in the `ftp` way) must not be read as one: its `:` is escaped, and
  // shows in the stripper's words. Only an address in one run of marks: a
  // marker between `//` and the next character already stops the reader's.
  characters.forEach((character, index) => {
    if (character !== ':' || linked(index)) return;
    // `https:`, `http:` or `ftp:`, ending at this `:`.
    for (const start of ftp
      ? [index - 5, index - 4, index - 3]
      : [index - 5, index - 4]) {
      const marks = line[start]?.marks;
      if (
        start >= 0 &&
        marks &&
        !linked(start) &&
        ADDRESS_START.test(characters.slice(start, index + 4).join('')) &&
        line
          .slice(start, index + 4)
          .every((part) => sameKeys(part.marks, marks))
      )
        written[index] = '\\:';
    }
  });
  if (tags)
    characters.forEach((character, index) => {
      if (
        character === '<' &&
        OPENS_HTML.test(characters.slice(index, index + 2).join(''))
      )
        written[index] = '\\<';
    });
  const text = characters.join('');
  if (OPENS_BLOCK.test(text) && !written[0]?.startsWith('\\'))
    written[0] = `\\${characters[0] ?? ''}`;
  const number = OPENS_NUMBERED.exec(text);
  if (number)
    written[number[0].length] = `\\${characters[number[0].length] ?? ''}`;
  if (!prefix && OPENS_HTML.test(text)) written[0] = '\\<';
  if (prefix) {
    // A run of `#` at the end of a title, after a space, closes the title.
    let end = characters.length;
    while (end > 0 && BLANK.test(characters[end - 1] ?? '')) end -= 1;
    let start = end;
    while (start > 0 && characters[start - 1] === '#') start -= 1;
    if (start < end && (start === 0 || BLANK.test(characters[start - 1] ?? '')))
      written[start] = '\\#';
  }
  return written;
}

/** What the stripper shows for one written character. */
function stripped(written: string): string {
  return written.length === 2 &&
    written.startsWith('\\') &&
    UNESCAPED.has(written.slice(1))
    ? written.slice(1)
    : written;
}

type Segment = { start: number; end: number; keys: Map<string, Mark> };

function segmentsOf(line: Line): Segment[] {
  const segments: Segment[] = [];
  line.forEach((character, index) => {
    const last = segments.at(-1);
    if (last && sameKeys(last.keys, character.marks)) last.end = index + 1;
    else segments.push({ start: index, end: index + 1, keys: character.marks });
  });
  return segments;
}

/** The first segment at or after `from` that `key` is not on. */
function runEnd(
  segments: readonly Segment[],
  from: number,
  key: string,
): number {
  const end = segments.findIndex(
    (segment, index) => index >= from && !segment.keys.has(key),
  );
  return end === -1 ? segments.length : end;
}

type Emitted = { markdown: string; plain: string };

/** A link written as its bare address: which segment, and where it ends. */
type Bare = { segment: number; href: string; end: number };

/**
 * Whether the reader's bare-address rule, reading on from `href` into
 * `following`, ends exactly at the end of `href`: GitHub's rule reads on to
 * the next space or `<` and gives back trailing punctuation.
 */
function endsAtAddress(href: string, following: string): boolean {
  let extent = href + (/^[^\s<]*/.exec(following)?.[0] ?? '');
  for (;;) {
    const next = BACKPEDAL.exec(extent)?.[0] ?? '';
    if (next === extent) return extent === href;
    extent = next;
  }
}

/**
 * `line` written as Markdown, its marks closed at its end, with the words the
 * stripper should read from it. A link that shows its own address is written
 * as the bare address where the reader's link would end with it, and as
 * `[address](address)` elsewhere.
 */
function emit(
  line: Line,
  prefix: string,
  variant: Variant,
  everything = false,
): Emitted {
  const bracketed = new Set<number>();
  for (;;) {
    const { markdown, plain, bare } = emitOnce(
      line,
      prefix,
      variant,
      everything,
      bracketed,
    );
    const runsOn = bare.find(
      ({ href, end }) => !endsAtAddress(href, markdown.slice(end)),
    );
    if (!runsOn) return { markdown, plain };
    bracketed.add(runsOn.segment);
  }
}

function emitOnce(
  line: Line,
  prefix: string,
  variant: Variant,
  everything: boolean,
  bracketed: ReadonlySet<number>,
): Emitted & { bare: Bare[] } {
  const escaped = escapedCharacters(line, prefix, everything, variant);
  const segments = segmentsOf(line);
  const open: { key: string; close: string }[] = [];
  const bares: Bare[] = [];
  let markdown = '';
  let plain = '';
  segments.forEach((segment, index) => {
    let keep = 0;
    while (keep < open.length && segment.keys.has(open[keep]?.key ?? ''))
      keep += 1;
    while (open.length > keep) markdown += open.pop()?.close ?? '';

    const shown = line
      .slice(segment.start, segment.end)
      .map((character) => character.text)
      .join('');
    let bare: string | null = null;
    const opening = [...segment.keys.keys()]
      .filter((key) => !open.some((mark) => mark.key === key))
      // The mark that lasts longest opens first, outermost.
      .sort(
        (a, b) =>
          runEnd(segments, index, b) - runEnd(segments, index, a) ||
          rank(a) - rank(b),
      );
    for (const key of opening) {
      if (key.startsWith(LINK)) {
        const href = key.slice(LINK.length);
        // A link that shows its own address, alone in its segment, may be
        // written as the bare address: the reader links it by itself.
        if (
          variant.bareLinks &&
          !bracketed.has(index) &&
          runEnd(segments, index, key) === index + 1 &&
          shown === href
        ) {
          bare = href;
          continue;
        }
        // `![` would open an image.
        if (/(?:^|[^\\])(?:\\\\)*!$/.test(markdown)) {
          markdown = `${markdown.slice(0, -1)}\\!`;
        }
        markdown += '[';
        open.push({ key, close: `](${href})` });
        continue;
      }
      let marker = key === 'bold' ? '**' : key === 'strike' ? '~~' : '==';
      if (key === 'italic') {
        // The stripper reads `**` first and nothing inside it may be a `*`:
        // italic inside bold is written with `_`.
        const insideBold = open.some((mark) => mark.key === 'bold');
        marker = insideBold !== variant.flipItalic ? '_' : '*';
      }
      markdown += marker;
      open.push({ key, close: marker });
    }
    const written = escaped.slice(segment.start, segment.end);
    if (bare !== null) {
      markdown += shown;
      plain += shown;
      bares.push({ segment: index, href: bare, end: markdown.length });
    } else {
      markdown += written.join('');
      plain += written.map(stripped).join('');
    }
  });
  while (open.length) markdown += open.pop()?.close ?? '';
  return { markdown, plain, bare: bares };
}

/** An ASCII punctuation mark: CommonMark reads each one escaped as itself. */
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/**
 * `line` with its links only and every ASCII punctuation mark escaped: a form
 * the reader always reads as these words, written only when nothing else
 * agrees. The stripper then shows the backslashes it does not unescape.
 */
function plainest(line: Line, prefix: string): Emitted {
  return emit(
    linksOnly(line),
    prefix,
    { flipItalic: false, bareLinks: false, tags: true, ftp: true },
    true,
  );
}

/** `btrim` of spaces, as the stripper ends. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

/** Whether `a` and `b` are the same document nodes. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return (
    left.length === right.length &&
    left.every(([key, value]) =>
      same(value, (b as Record<string, unknown>)[key]),
    )
  );
}

/** What the reader reads `markdown` as: its blocks, nothing for nothing. */
function readBack(markdown: string): JSONContent[] {
  if (!markdown) return [];
  try {
    return blocks(lexFormattedText(markdown));
  } catch {
    return [];
  }
}

/**
 * Whether the reader and the stripper read `written`, a line after `prefix`
 * (a Titlu's `# ` or `## `, or nothing), as `line`: `-1` when both do,
 * else about where in `line` one of them first reads it differently, for the
 * search to look there first.
 */
function disagreement(written: Emitted, line: Line, prefix: string): number {
  const source = prefix + written.markdown;
  const expected = prefix
    ? headingNode(prefix === '# ' ? 1 : 2, inlineOf([line]))
    : paragraphNode(inlineOf([line]));
  const back = readBack(source);
  if (!same(back, [expected])) {
    const [read = []] =
      back.length === 1 ? linesOf(back[0]?.content ?? []) : [[]];
    const at = line.findIndex((character, index) => {
      const other = read[index];
      return (
        other?.text !== character.text ||
        !sameKeys(other.marks, character.marks)
      );
    });
    return at === -1 ? line.length : at;
  }
  const read = toPlainText(source);
  const plain = trimSpaces(written.plain);
  if (read === plain) return -1;
  let at = 0;
  while (read[at] === plain[at]) at += 1;
  return Math.min(at, line.length);
}

/** `line` with the mark `key` taken off its characters `[start, end)`. */
function without(
  line: Line,
  key: string,
  [start, end]: [number, number],
): Line {
  return line.map((character, index) => {
    if (index < start || index >= end) return character;
    const marks = new Map(character.marks);
    marks.delete(key);
    return { text: character.text, marks };
  });
}

/**
 * How many ways of writing one line the search reads back before it settles
 * for the line's links only (ruling 27). The editor writes its whole text on
 * every change, and a line with many marks the dialect cannot hold would
 * otherwise try thousands; a line that is written as typed takes one to four.
 */
export const LINE_CHECKS = 32;

type Budget = { left: number };

type Attempt = { written: Emitted | null; at: number };

/**
 * `line` written in the first way both readers read as `line`, or `null`
 * with where the first way tried was read differently. Each way read back
 * spends one check of `budget`; none is tried once it is spent.
 */
function attempt(
  line: Line,
  prefix: string,
  budget: Budget = { left: Infinity },
): Attempt {
  const tried = new Set<string>();
  let at = -1;
  for (const variant of VARIANTS) {
    const written = emit(line, prefix, variant);
    if (tried.has(written.markdown)) continue;
    tried.add(written.markdown);
    if (budget.left <= 0) break;
    budget.left -= 1;
    const where = disagreement(written, line, prefix);
    if (where < 0) return { written, at: -1 };
    if (at < 0) at = where;
  }
  return { written: null, at: Math.max(at, 0) };
}

/** How far `run` is from the character `at`: 0 when it holds it. */
function distance([start, end]: [number, number], at: number): number {
  if (at < start) return start - at;
  return at >= end ? at - end + 1 : 0;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

type Run = { key: string; run: [number, number] };

function runsIn(line: Line): Run[] {
  return keysOf(line)
    .flatMap((key) => runsOf(line, key).map((run) => ({ key, run })))
    .sort((a, b) => a.run[0] - b.run[0] || rank(a.key) - rank(b.key));
}

/**
 * The mark of `run` taken off the punctuation at its edges, one character
 * more each time: `**x.**a` as `**x**.a`.
 */
function offPunctuation(line: Line, { key, run }: Run): Line[] {
  const [start, end] = run;
  const options: Line[] = [];
  let last = end;
  while (last - 1 > start && !WORD_CHARACTER.test(line[last - 1]?.text ?? '')) {
    last -= 1;
    options.push(without(line, key, [last, end]));
  }
  let first = start;
  while (first + 1 < end && !WORD_CHARACTER.test(line[first]?.text ?? '')) {
    first += 1;
    options.push(without(line, key, [start, first]));
  }
  return options;
}

function linksOnly(line: Line): Line {
  return line.map((character) => ({
    text: character.text,
    marks: new Map(
      [...character.marks].filter(([key]) => key.startsWith(LINK)),
    ),
  }));
}

/** How plainly a part is written: formatted, links only, or all escaped. */
type Level = 0 | 1 | 2;

type LineWritten = { markdown: string; line: Line };

/**
 * `line` (normalised, not empty) as Markdown both readers read back as the
 * line returned with it: its own marks where the dialect holds them, a mark
 * off the fewest characters where it does not.
 */
function writeLine(line: Line, prefix: string, level: Level): LineWritten {
  if (level === 0) {
    const found = search(line, prefix, { left: LINE_CHECKS });
    if (found) return found;
  }
  // The last resort keeps every Text Link: the line's links only, its
  // addresses linked whole, written as usual or else every mark escaped.
  const links = relinked(linksOnly(line));
  const written = level < 2 ? attempt(links, prefix).written : null;
  return {
    markdown: (written ?? plainest(links, prefix)).markdown,
    line: links,
  };
}

/**
 * The search for `line`: its own marks where the dialect holds them, a style
 * off the fewest characters where it does not, within `budget`. The runs
 * nearest where the readers first disagree are tried first. `null` when the
 * budget is spent or no style is left to take off.
 */
function search(
  line: Line,
  prefix: string,
  budget: Budget,
): LineWritten | null {
  let current = line;
  for (;;) {
    const { written, at } = attempt(current, prefix, budget);
    if (written) return { markdown: written.markdown, line: current };
    if (budget.left <= 0) return null;
    // A Text Link never comes off here: once only links are left, the last
    // resort (`writeLine`) writes them, every one kept. A line that still
    // disagrees then holds a link whose address the reader reads otherwise
    // (`\*` in it, from pasted HTML), and dropping the link would lose it.
    const runs = runsIn(current)
      .filter(({ key }) => !key.startsWith(LINK))
      .sort((a, b) => distance(a.run, at) - distance(b.run, at));
    const [first] = runs;
    if (!first) return null;
    // Once a style comes off, an address it split is linked whole: every
    // step takes a style away, so the search ends.
    for (const option of lighterLines(current, runs)) {
      const fixed = attempt(option, prefix, budget).written;
      if (fixed) return { markdown: fixed.markdown, line: option };
      if (budget.left <= 0) return null;
    }
    current = relinked(without(current, first.key, first.run));
  }
}

/**
 * The lines one step lighter than `line`, run by run in the order given,
 * built one at a time as the search reads them (most are never read within
 * its budget): the run's mark off the punctuation at its edges, then off the
 * whole run, with every address it split linked whole.
 */
function* lighterLines(line: Line, runs: readonly Run[]): Generator<Line> {
  for (const run of runs) {
    for (const option of [
      ...offPunctuation(line, run),
      without(line, run.key, run.run),
    ]) {
      const lighter = relinked(option);
      if (!sameLine(lighter, line)) yield lighter;
    }
  }
}

/**
 * `line` normalised, with every address its marks now leave whole linked
 * (fix round 2): once a mark comes off, an address that stopped where that
 * mark changed is one address again, and the text read back would link it.
 */
function relinked(line: Line): Line {
  return autolinked(normalized(line));
}

function sameLine(a: Line, b: Line): boolean {
  return (
    a.length === b.length &&
    a.every((character, index) => {
      const other = b[index];
      return (
        other?.text === character.text && sameKeys(character.marks, other.marks)
      );
    })
  );
}

type Written = { markdown: string; node: JSONContent };

/** The first of `lines` that `back`, the paragraph read back, shows differently. */
function firstDifferentLine(back: JSONContent[], lines: readonly Line[]) {
  const read = back.flatMap((block) =>
    block.type === 'paragraph' ? linesOf(block.content ?? []) : [[]],
  );
  const index = lines.findIndex(
    (line, at) => !same(inlineOf([line]), inlineOf([read[at] ?? []])),
  );
  return index === -1 ? 0 : index;
}

/**
 * A paragraph's lines, each checked alone, then the paragraph read back
 * whole: `marked` can pair a marker on one line with one on another, and then
 * the first line read differently is written plainer until it agrees.
 */
function writeParagraph(lines: readonly Line[], level: Level): Written {
  const levels = lines.map(() => level);
  const written = lines.map((line) => writeLine(line, '', level));
  for (;;) {
    const markdown = written.map((part) => part.markdown).join('\n');
    const node = paragraphNode(inlineOf(written.map((part) => part.line)));
    const back = readBack(markdown);
    if (same(back, [node])) return { markdown, node };
    const index = firstDifferentLine(
      back,
      written.map((part) => part.line),
    );
    const plainer = levels.findIndex((at, line) => line >= index && at < 2);
    const line = lines[plainer];
    if (plainer === -1 || !line) return { markdown, node };
    const next = ((levels[plainer] ?? 0) + 1) as Level;
    levels[plainer] = next;
    written[plainer] = writeLine(line, '', next);
  }
}

function writeItem(item: JSONContent, level: Level): Written {
  const parts = (item.content ?? []).map((child) => writeBlock(child, level));
  let body = '';
  parts.forEach((part, index) => {
    const previous = parts[index - 1];
    if (previous) {
      // A nested list sits right under its item's words, unless its first
      // item opens with no words: a lone `-` under words underlines them as
      // a heading. Anything else sits a line apart, and anything under an
      // item with no words of its own on the next line.
      const tight =
        !previous.markdown ||
        (previous.node.type === 'paragraph' &&
          isList(part.node) &&
          !/^(?:-|\d{1,9}\.)(?:\n|$)/.test(part.markdown));
      body += tight ? '\n' : '\n\n';
    }
    body += part.markdown;
  });
  return { markdown: body, node: itemNode(parts.map((part) => part.node)) };
}

function writeList(node: JSONContent, level: Level): Written {
  const ordered = node.type === 'orderedList';
  const start = ordered ? Number(node.attrs?.start ?? 1) : 1;
  const items = (node.content ?? []).map((item) => writeItem(item, level));
  const markdown = items
    .map(({ markdown: body }, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      const indent = ' '.repeat(marker.length);
      return body
        .split('\n')
        .map((line, at) =>
          at === 0 ? (marker + line).trimEnd() : line && indent + line,
        )
        .join('\n');
    })
    .join('\n');
  const content = items.map((item) => item.node);
  return { markdown, node: listNode(ordered, start, content) };
}

/** A block of the normalised document, written at `level`. */
function writeBlock(node: JSONContent, level: Level): Written {
  switch (node.type) {
    case 'heading': {
      const prefix = node.attrs?.level === 1 ? '# ' : '## ';
      const [line = []] = linesOf(node.content ?? []);
      const written = writeLine(line, prefix, level);
      return {
        markdown: prefix + written.markdown,
        node: headingNode(Number(node.attrs?.level), inlineOf([written.line])),
      };
    }
    case 'blockquote': {
      const parts = (node.content ?? []).map((child) =>
        writeBlock(child, level),
      );
      const markdown = parts
        .map((part) => part.markdown)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      return { markdown, node: quoteNode(parts.map((part) => part.node)) };
    }
    case 'bulletList':
    case 'orderedList':
      return writeList(node, level);
    default: {
      const lines = linesOf(node.content ?? []);
      if (!lines.some((line) => line.length))
        return { markdown: '', node: paragraphNode() };
      return writeParagraph(lines, level);
    }
  }
}

/**
 * Blocks already written, by their normalised JSON: the editor writes its
 * whole text on every change, and a keystroke changes one block. A block's
 * text depends on the block alone; the whole-text check still runs each time.
 */
const writtenBlocks = new Map<string, Written>();

/** Forget the blocks already written, so a test counts a write whole; for tests only. */
export function resetWrittenBlocksForTests() {
  writtenBlocks.clear();
}

function writeTopBlock(node: JSONContent): Written {
  const key = JSON.stringify(node);
  const known = writtenBlocks.get(key);
  if (known) return known;
  const written = writeBlock(node, 0);
  if (writtenBlocks.size >= 256) writtenBlocks.clear();
  writtenBlocks.set(key, written);
  return written;
}

/**
 * The editor's document as Formatted Text, in the dialect both readers read:
 * blocks a blank line apart, a hard break as a bare `\n`, `#`/`##` titles,
 * `> ` quotes, `- `/`1. ` lists, `**`, `*` (`_` inside bold), `~~`, `==` and
 * `[words](https://…)` or a bare address, every literal marker escaped. What
 * it writes is `normalizeFormattedText(doc)`, less any mark the dialect cannot
 * hold where it stands, and with an address linked to itself where dropping
 * such a mark made it one address. The whole text is read back before it is
 * returned; a
 * block read differently is written plainer until it reads as written. An
 * empty document is the empty string.
 */
export function serializeFormattedText(doc: JSONContent): string {
  const target = normalizedBlocks(doc.content ?? []);
  const levels = target.map((): Level => 0);
  const written = target.map(writeTopBlock);
  for (;;) {
    const markdown = written.map((part) => part.markdown).join('\n\n');
    const expected = written.map((part) => part.node);
    const back = readBack(markdown);
    if (same(back, expected)) return markdown;
    // The first block read differently, or the one before it, which can
    // change it, is written plainer.
    const index = expected.findIndex((node, at) => !same(back[at], node));
    const plainer = levels.findIndex(
      (at, block) => block >= Math.max(0, index - 1) && at < 2,
    );
    const block = target[plainer];
    if (plainer === -1 || !block) return markdown;
    const next = ((levels[plainer] ?? 0) + 1) as Level;
    levels[plainer] = next;
    written[plainer] = writeBlock(block, next);
  }
}
