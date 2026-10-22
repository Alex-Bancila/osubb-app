// @vitest-environment node
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { toPlainText } from '../../../lib/formatted-text/plain';
import {
  normalizeFormattedText,
  parseFormattedText,
  serializeFormattedText,
} from './markdown';

/**
 * Random documents through the editor's writer (ruling 21, fix rounds 1 and
 * 2). Each must write a text that saves the same way the second time, reads
 * back as the document it was written from with marks dropped and addresses
 * linked only, and strips to the document's words. Fixed seeds, so a failure
 * is a regression to pin with its own test in `markdown.test.tsx`.
 */

/** mulberry32: a small seeded generator. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words, markers, whole addresses and HTML: what the readers can trip on. */
const MIXED = [
  ...'ab  ș*_~=[]()!#-1.<>\\`|&:+"x',
  'https://x.ro/a',
  'http://y.ro',
  'www.a.ro',
  '<div>',
  '<!--',
  '0740123456.',
];

/**
 * Addresses in pieces, each piece with its own marks, among the punctuation
 * an address ends on (fix round 2: an address split by marks), and `ftp://`,
 * which `marked` reads as an address the reader shows as typed (fix round 3).
 */
const ADDRESSES = [
  'https://',
  'http://',
  'ftp://',
  'x.ro',
  'b.ro',
  'www.',
  'amp;',
  ...'/aș.:_*~=\\`|[]()&;?!,<>"\'#%-@ 1+',
];

type Pieces = { words: readonly string[]; hrefs: readonly string[] };

const VARIANTS: [string, Pieces][] = [
  [
    'mixed',
    {
      words: MIXED,
      hrefs: ['https://x.ro/a', 'https://x.ro/b(c)', 'javascript:x'],
    },
  ],
  [
    'address-heavy',
    {
      words: ADDRESSES,
      hrefs: ['https://x.ro/a', 'https://x.ro', 'http://y.ro/(z)'],
    },
  ],
];

const MARKS = ['bold', 'italic', 'strike', 'highlight', 'link'];

function documents(seed: number, count: number, pieces: Pieces) {
  const random = generator(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;
  const inline = (): JSONContent[] =>
    Array.from({ length: 1 + Math.floor(random() * 5) }, (): JSONContent => {
      if (random() < 0.1) return { type: 'hardBreak' };
      const text = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
        pick(pieces.words),
      ).join('');
      const marks = MARKS.filter(() => random() < 0.17).map((type) =>
        type === 'link'
          ? { type, attrs: { href: pick(pieces.hrefs) } }
          : { type },
      );
      return marks.length
        ? { type: 'text', text, marks }
        : { type: 'text', text };
    });
  const block = (depth: number): JSONContent => {
    const roll = random();
    if (depth > 2 || roll < 0.45)
      return { type: 'paragraph', content: inline() };
    if (roll < 0.6)
      return {
        type: 'heading',
        attrs: { level: pick([1, 2]) },
        content: inline(),
      };
    if (roll < 0.75)
      return {
        type: 'blockquote',
        content: Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
          block(depth + 1),
        ),
      };
    const items = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
      const content: JSONContent[] = [
        random() < 0.15
          ? { type: 'paragraph' }
          : { type: 'paragraph', content: inline() },
      ];
      if (random() < 0.3) content.push(block(depth + 1));
      return { type: 'listItem', content };
    });
    return random() < 0.5
      ? {
          type: 'orderedList',
          attrs: { start: pick([1, 1, 3]) },
          content: items,
        }
      : { type: 'bulletList', content: items };
  };
  return Array.from({ length: count }, (): JSONContent => ({
    type: 'doc',
    content: Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
      block(0),
    ),
  }));
}

/** The document without marks, adjacent texts joined. */
function bare(node: JSONContent): JSONContent {
  if (node.type === 'text') return { type: 'text', text: node.text };
  if (!node.content) return { ...node };
  const content: JSONContent[] = [];
  for (const child of node.content.map(bare)) {
    const last = content.at(-1);
    if (last?.type === 'text' && child.type === 'text')
      last.text = (last.text ?? '') + (child.text ?? '');
    else content.push(child);
  }
  return { ...node, content };
}

type Character = { text: string; marks: string[]; href: string | null };

/** Each character with its marks, in document order; a hard break as `\n`. */
function characters(node: JSONContent): Character[] {
  if (node.type === 'text')
    return [...(node.text ?? '')].map((text) => ({
      text,
      marks: (node.marks ?? []).map(
        (mark) => `${mark.type} ${mark.attrs?.href ?? ''}`,
      ),
      href:
        (node.marks ?? []).find((mark) => mark.type === 'link')?.attrs?.href ??
        null,
    }));
  if (node.type === 'hardBreak') return [{ text: '\n', marks: [], href: null }];
  return (node.content ?? []).flatMap(characters);
}

/** The words a document strips to: its texts, a bullet or a number per item. */
function words(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  const content = node.content ?? [];
  if (node.type === 'bulletList')
    return content.map((item) => `•${words(item)}`).join('');
  if (node.type === 'orderedList') {
    const start = Number(node.attrs?.start ?? 1);
    return content
      .map((item, index) => `${start + index}.${words(item)}`)
      .join('');
  }
  return content.map(words).join('');
}

/**
 * The two shapes whose markers the stripper keeps (a database follow-up,
 * like `\<`): a quote inside a quote, and a list item that opens with no
 * words of its own.
 */
function stripperKeepsMarkers(node: JSONContent, inQuote = false): boolean {
  if (node.type === 'blockquote' && inQuote) return true;
  if (node.type === 'listItem' && !node.content?.[0]?.content?.length)
    return true;
  return (node.content ?? []).some((child) =>
    stripperKeepsMarkers(child, inQuote || node.type === 'blockquote'),
  );
}

const unspaced = (value: string) => value.replace(/\s/g, '');

/**
 * Whether `stripped` holds exactly `expected`'s words, spaces aside, with no
 * backslash the document did not have but two the stripper keeps, since
 * `plain.ts` unescapes neither `<` nor `:` (database follow-ups): one before
 * a `<` anywhere (a `<` opening a line, or any tag's on a line whose raw HTML
 * holds a marker), and one before the `:` of an `ftp://` address.
 */
function sameWords(stripped: string, expected: string): boolean {
  const left = unspaced(stripped);
  const right = unspaced(expected);
  const kept = (to: number) =>
    right[to] === '<' ||
    (right[to] === ':' && /ftp$/i.test(right.slice(Math.max(0, to - 3), to)));
  let at = 0;
  let to = 0;
  while (at < left.length && to < right.length) {
    if (left[at] === right[to]) {
      at += 1;
      to += 1;
    } else if (left[at] === '\\' && left[at + 1] === right[to] && kept(to))
      at += 1;
    else return false;
  }
  return at === left.length && to === right.length;
}

/** A Text Link's address as the writer keeps it: parentheses encoded. */
const encoded = (text: string) =>
  text.replace(/\(/g, '%28').replace(/\)/g, '%29');

describe.each(VARIANTS)(
  'any document, %s, written (ruling 21)',
  (_, pieces) => {
    const cases = documents(20261021, 300, pieces);
    // Written once and read back once, for every check below.
    let memo: { json: JSONContent; markdown: string; back: JSONContent }[] = [];
    const written = () => {
      if (!memo.length)
        memo = cases.map((json) => {
          const markdown = serializeFormattedText(json);
          return { json, markdown, back: parseFormattedText(markdown) };
        });
      return memo;
    };

    it('saves the same way the second time as the first', () => {
      for (const { markdown, back } of written())
        expect(serializeFormattedText(back)).toBe(markdown);
    });

    it('reads back as its normalised document, its words and blocks whole', () => {
      for (const { json, back } of written())
        expect(bare(back)).toEqual(bare(normalizeFormattedText(json)));
    });

    it('only drops marks, and adds only a link from an address to itself', () => {
      for (const { json, back } of written()) {
        const intended = characters(normalizeFormattedText(json));
        const read = characters(back);
        read.forEach((character, index) => {
          const before = intended[index];
          for (const mark of character.marks) {
            if (before?.marks.includes(mark)) continue;
            // A link added where there was none: to the address it shows.
            expect(before?.href).toBeNull();
            expect(mark.startsWith('link ')).toBe(true);
            let start = index;
            while (read[start - 1]?.href === character.href) start -= 1;
            let end = index;
            while (read[end]?.href === character.href) end += 1;
            const shown = read
              .slice(start, end)
              .map((part) => part.text)
              .join('');
            expect(encoded(shown)).toBe(character.href);
          }
        });
      }
    });

    it('gives the stripper the document’s words, with no backslash of its own', () => {
      let checked = 0;
      for (const { json, markdown } of written()) {
        const normal = normalizeFormattedText(json);
        if (stripperKeepsMarkers(normal)) continue;
        checked += 1;
        const stripped = toPlainText(markdown);
        if (!sameWords(stripped, words(normal)))
          expect({ markdown, stripped }).toEqual({
            markdown,
            stripped: words(normal),
          });
      }
      expect(checked).toBeGreaterThan(150);
    });
  },
);
