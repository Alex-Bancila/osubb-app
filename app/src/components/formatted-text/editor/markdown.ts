import type { JSONContent } from '@tiptap/core';
import type { MarkedToken, Token, Tokens } from 'marked';
import { lexFormattedText } from '../../../lib/formatted-text/lex';
import { toPlainText } from '../../../lib/formatted-text/plain';
import { safeHttpUrl } from '../../../lib/links';

/**
 * The editor's Markdown (ruling R60, ruling 21): the one dialect the reader
 * (`FormattedText`, through `lexFormattedText`) and the stripper (`toPlainText`,
 * `private.formatted_text_plain`) read, in both directions.
 *
 * Reading uses the reader's own tokens and maps them as `FormattedText` does,
 * so the editor opens a text exactly as the reader shows it: a single line
 * break is a hard break, and whatever is outside the dialect (raw HTML, code,
 * tables, images, a refused link) comes in as the words it was typed as.
 *
 * Writing is checked line by line. Each line is written, read back by the
 * reader's lexer and by the stripper, and kept only when both read the words
 * and marks it was written from. Where the dialect cannot hold a mark there
 * (italic inside a word, bold around a literal `*`, a closing `**` between
 * punctuation and a letter) that mark is written as plain words, one run at a
 * time, until both agree. No mark ever spans a hard break: each line closes
 * its marks, so `**a**\n**b**`, never `**a\nb**`.
 *
 * `@tiptap/markdown`'s own parser and serializer write a different dialect
 * (`&amp;` for `&`, `  \n` for a break, `&nbsp;` for an empty paragraph, raw
 * HTML read as formatting), so the editor's `Markdown` extension uses these two
 * functions instead (`extensions.ts`).
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
 * A Text Link's address as it is written: parentheses encoded, since the
 * stripper's Text Link ends at the first `)`.
 */
function writtenHref(href: string): string {
  return href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** A mark of the dialect, by key (a link's key holds its address), or `null`. */
function keyed(mark: Mark): [string, Mark] | null {
  if (mark.type === 'link') {
    const href =
      typeof mark.attrs?.href === 'string'
        ? safeHttpUrl(mark.attrs.href)
        : null;
    return href
      ? [LINK + writtenHref(href), { type: 'link', attrs: { href } }]
      : null;
  }
  return STYLES.has(mark.type) ? [mark.type, { type: mark.type }] : null;
}

function rank(key: string): number {
  return RANK.indexOf(key.startsWith(LINK) ? 'link' : key);
}

/* ------------------------------------------------------------------------ */
/* Lines: the shape both directions normalise to                            */
/* ------------------------------------------------------------------------ */

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

/**
 * Every run of `key` in `line`, as `[start, end)`. A link's key holds its
 * address, so two links side by side are two runs.
 */
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
  const characters = line.slice(start, end).map((character) => ({
    text: character.text,
    marks: new Map(character.marks),
  }));
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
      const marks = [...run.marks.values()];
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
 * Inline content as the paragraphs the reader shows: lines normalised, the
 * empty ones at either end dropped, and an empty line between two others (a
 * blank line in the Markdown) starting a new paragraph.
 */
function paragraphsOf(content: readonly JSONContent[]): JSONContent[] {
  const groups: Line[][] = [[]];
  for (const line of linesOf(content).map(normalized)) {
    const group = groups.at(-1) ?? [];
    if (line.length) group.push(line);
    else if (group.length) groups.push([]);
  }
  return groups
    .filter((group) => group.length)
    .map((group) => ({ type: 'paragraph', content: inlineOf(group) }));
}

/* ------------------------------------------------------------------------ */
/* Reading: the reader's tokens, mapped as FormattedText maps them           */
/* ------------------------------------------------------------------------ */

/** As `FormattedText`'s `isDialectHeading`: a Titlu written with `#`. */
function isDialectHeading(token: Tokens.Heading): boolean {
  return /^[ \t]*#{1,6}(?:[ \t]|\n|$)/.test(token.raw);
}

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

/** As `FormattedText`'s `linkTarget`: the address of a Text Link, or `null`. */
function textLinkHref(token: Tokens.Link): string | null {
  const written =
    (token.raw.startsWith('[') && token.raw.endsWith(')')) ||
    token.raw === token.href;
  if (!written || !token.tokens.length) return null;
  return safeHttpUrl(token.href);
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
        const href = textLinkHref(span);
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
  if (!line.length) return [];
  return [
    {
      type: 'heading',
      attrs: { level: token.depth === 1 ? 1 : 2 },
      content: inlineOf([line]),
    },
  ];
}

function list(token: Tokens.List): JSONContent {
  const content = token.items.map((item) => {
    const children = blocks(item.tokens);
    // An item opens with words; one that opens with a title or a quote opens
    // with an empty line, as it was written.
    if (children[0]?.type !== 'paragraph')
      children.unshift({ type: 'paragraph' });
    return { type: 'listItem', content: children };
  });
  if (!token.ordered) return { type: 'bulletList', content };
  const start = typeof token.start === 'number' ? token.start : 1;
  return { type: 'orderedList', attrs: { start }, content };
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
        return content.length ? [{ type: 'blockquote', content }] : [];
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
    content: content.length ? content : [{ type: 'paragraph' }],
  };
}

/* ------------------------------------------------------------------------ */
/* Writing                                                                  */
/* ------------------------------------------------------------------------ */

type Variant = { flipItalic: boolean; bareLinks: boolean };

const PLAIN: Variant = { flipItalic: false, bareLinks: true };

const VARIANTS: readonly Variant[] = [
  PLAIN,
  { flipItalic: true, bareLinks: true },
  { flipItalic: false, bareLinks: false },
  { flipItalic: true, bareLinks: false },
];

/** Always written escaped: the dialect reads each anywhere in a line. */
const ESCAPED = new Set(['\\', '*', '_', '~', '`', '[', ']', '|']);

/**
 * At the start of a line, what would open a block: a Titlu, a quote, a list
 * item, or a rule or heading underline (`---`, `=`).
 */
const OPENS_BLOCK =
  /^(?:#{1,6}(?:[ \t]|$)|>|[-+](?:[ \t]|$)|-+[ \t]*$|=+[ \t]*$)/;
const OPENS_NUMBERED = /^\d{1,9}(?=[.)](?:[ \t]|$))/;

/** Each character of `line` as it is written, escaped where the dialect needs it. */
function escapedCharacters(line: Line, inHeading: boolean): string[] {
  const characters = line.map((character) => character.text);
  const written = characters.map((character, index) => {
    if (ESCAPED.has(character)) return `\\${character}`;
    // `==` opens a highlight; a single `=` is a word.
    if (
      character === '=' &&
      (characters[index - 1] === '=' || characters[index + 1] === '=')
    )
      return '\\=';
    return character;
  });
  const text = characters.join('');
  if (OPENS_BLOCK.test(text) && !written[0]?.startsWith('\\'))
    written[0] = `\\${characters[0] ?? ''}`;
  const number = OPENS_NUMBERED.exec(text);
  if (number)
    written[number[0].length] = `\\${characters[number[0].length] ?? ''}`;
  if (inHeading) {
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

/** `line` written as Markdown, its marks closed at its end. */
function emit(line: Line, inHeading: boolean, variant: Variant): string {
  const escaped = escapedCharacters(line, inHeading);
  const segments = segmentsOf(line);
  const open: { key: string; close: string }[] = [];
  let out = '';
  segments.forEach((segment, index) => {
    let keep = 0;
    while (keep < open.length && segment.keys.has(open[keep]?.key ?? ''))
      keep += 1;
    while (open.length > keep) out += open.pop()?.close ?? '';

    const shown = line
      .slice(segment.start, segment.end)
      .map((character) => character.text)
      .join('');
    let bare = false;
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
        // A link that shows its own address, alone in its segment, is
        // written as the bare address: the reader links it by itself.
        if (
          variant.bareLinks &&
          runEnd(segments, index, key) === index + 1 &&
          shown === href
        ) {
          bare = true;
          continue;
        }
        // `![` would open an image.
        if (/(?:^|[^\\])(?:\\\\)*!$/.test(out)) out = `${out.slice(0, -1)}\\!`;
        out += '[';
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
      out += marker;
      open.push({ key, close: marker });
    }
    out += bare ? shown : escaped.slice(segment.start, segment.end).join('');
  });
  while (open.length) out += open.pop()?.close ?? '';
  return out;
}

/** `btrim` of spaces, as the stripper ends. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

/**
 * Whether the reader and the stripper read `markdown`, a line written after
 * `prefix` (a Titlu's `# `, or nothing), as `line`. A bare address the line
 * holds as words is read as a link, which is the dialect's rule.
 */
function agrees(markdown: string, line: Line, prefix: string): boolean {
  const source = prefix + markdown;
  let read: JSONContent[];
  try {
    read = blocks(lexFormattedText(source));
  } catch {
    return false;
  }
  const [only] = read;
  if (read.length !== 1 || !only) return false;
  if (prefix) {
    if (
      only.type !== 'heading' ||
      only.attrs?.level !== (prefix === '# ' ? 1 : 2)
    )
      return false;
  } else if (only.type !== 'paragraph') return false;
  const lines = linesOf(only.content ?? []);
  const [back] = lines;
  if (lines.length !== 1 || !back || back.length !== line.length) return false;
  const same = line.every((character, index) => {
    const other = back[index];
    if (!other || other.text !== character.text) return false;
    const links = [...character.marks.keys()].filter((key) =>
      key.startsWith(LINK),
    );
    for (const [key] of other.marks)
      if (!character.marks.has(key) && !(key.startsWith(LINK) && !links.length))
        return false;
    return [...character.marks.keys()].every((key) => other.marks.has(key));
  });
  if (!same) return false;
  return (
    toPlainText(source) ===
    trimSpaces(line.map((character) => character.text).join(''))
  );
}

/** `line` with the run `[start, end)` of `key` written as plain words. */
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

/** `line` written in the first way both readers read as `line`, or `null`. */
function attempt(line: Line, prefix: string): string | null {
  const tried = new Set<string>();
  for (const variant of VARIANTS) {
    const markdown = emit(line, prefix !== '', variant);
    if (tried.has(markdown)) continue;
    tried.add(markdown);
    if (agrees(markdown, line, prefix)) return markdown;
  }
  return null;
}

/**
 * `line` (normalised, not empty) as Markdown both readers read back as it is,
 * dropping the marks the dialect cannot hold there: a single run whose
 * removal is enough if there is one, else runs in order until one is.
 */
function writeLine(line: Line, prefix: string): string {
  let current = line;
  for (;;) {
    const markdown = attempt(current, prefix);
    if (markdown !== null) return markdown;
    const runs = keysOf(current)
      .flatMap((key) => runsOf(current, key).map((run) => ({ key, run })))
      .sort((a, b) => a.run[0] - b.run[0] || rank(a.key) - rank(b.key));
    const [first] = runs;
    // Plain words always read back; should they not, they are still the words.
    if (!first) return emit(current, prefix !== '', PLAIN);
    for (const { key, run } of runs) {
      const fixed = attempt(without(current, key, run), prefix);
      if (fixed !== null) return fixed;
    }
    current = without(current, first.key, first.run);
  }
}

function paragraph(content: readonly JSONContent[]): string | null {
  const written: string[] = [];
  let blank = false;
  for (const line of linesOf(content).map(normalized)) {
    if (!line.length) {
      blank = written.length > 0;
      continue;
    }
    if (blank) written.push('');
    blank = false;
    written.push(writeLine(line, ''));
  }
  return written.length ? written.join('\n') : null;
}

function title(node: JSONContent): string | null {
  // A title is one line: a hard break inside it is a space.
  const lines = linesOf(node.content ?? []);
  const line = normalized(
    lines.flatMap((part, index) =>
      index > 0
        ? [{ text: ' ', marks: new Map<string, Mark>() }, ...part]
        : part,
    ),
  );
  if (!line.length) return null;
  const prefix = node.attrs?.level === 1 ? '# ' : '## ';
  return prefix + writeLine(line, prefix);
}

function itemBody(item: JSONContent): string {
  const parts: { type: string; markdown: string }[] = [];
  for (const child of item.content ?? []) {
    const markdown = writeBlock(child);
    if (markdown) parts.push({ type: child.type ?? '', markdown });
  }
  const [first] = parts;
  if (!first) return '';
  // An item that does not open with words opens with an empty line.
  let body = first.type === 'paragraph' ? '' : '\n';
  parts.forEach((part, index) => {
    const previous = parts[index - 1];
    if (previous)
      body +=
        previous.type === 'paragraph' && part.type.endsWith('List')
          ? '\n'
          : '\n\n';
    body += part.markdown;
  });
  return body;
}

function listOf(node: JSONContent): string | null {
  const ordered = node.type === 'orderedList';
  const start =
    ordered && typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
  const items = (node.content ?? []).map((item, index) => {
    const marker = ordered ? `${start + index}. ` : '- ';
    const indent = ' '.repeat(marker.length);
    return itemBody(item)
      .split('\n')
      .map((line, at) =>
        at === 0 ? (marker + line).trimEnd() : line && indent + line,
      )
      .join('\n');
  });
  return items.length ? items.join('\n') : null;
}

function writeBlock(node: JSONContent): string | null {
  switch (node.type) {
    case 'paragraph':
      return paragraph(node.content ?? []);
    case 'heading':
      return title(node);
    case 'blockquote': {
      const inner = (node.content ?? [])
        .map(writeBlock)
        .filter((markdown): markdown is string => !!markdown)
        .join('\n\n');
      return inner
        ? inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')
        : null;
    }
    case 'bulletList':
    case 'orderedList':
      return listOf(node);
    default:
      return null;
  }
}

/**
 * The editor's document as Formatted Text, in the dialect both readers read:
 * blocks a blank line apart, a hard break as a bare `\n`, `#`/`##` titles,
 * `> ` quotes, `- `/`1. ` lists, `**`, `*` (`_` inside bold), `~~`, `==` and
 * `[words](https://…)`, every literal marker escaped. Empty paragraphs are
 * not written; an empty document is the empty string.
 */
export function serializeFormattedText(doc: JSONContent): string {
  return (doc.content ?? [])
    .map(writeBlock)
    .filter((markdown): markdown is string => !!markdown)
    .join('\n\n');
}
