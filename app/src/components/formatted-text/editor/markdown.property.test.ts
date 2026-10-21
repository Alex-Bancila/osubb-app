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
 * Random documents through the editor's writer (ruling 21, fix round 1). Each
 * must write a text that reads back as the document it was written from, less
 * only marks, and writes again byte for byte the same. Fixed seed, so a
 * failure is a regression to pin with its own test in `markdown.test.tsx`.
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

/** Words, markers, addresses and HTML: what a reader and a stripper can trip on. */
const PIECES = [
  'a',
  'b',
  'ș',
  ' ',
  ' ',
  '*',
  '_',
  '~',
  '=',
  '[',
  ']',
  '(',
  ')',
  '!',
  '#',
  '-',
  '1',
  '.',
  '<',
  '>',
  '\\',
  '`',
  '|',
  '&',
  ':',
  '+',
  '"',
  'x',
  'https://x.ro/a',
  'http://y.ro',
  'www.a.ro',
  '<div>',
  '<!--',
  '0740123456.',
];
const HREFS = ['https://x.ro/a', 'https://x.ro/b(c)', 'javascript:x'];
const MARKS = ['bold', 'italic', 'strike', 'highlight', 'link'];

function documents(seed: number, count: number): JSONContent[] {
  const random = generator(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;
  const inline = (): JSONContent[] =>
    Array.from({ length: 1 + Math.floor(random() * 5) }, (): JSONContent => {
      if (random() < 0.12) return { type: 'hardBreak' };
      const text = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
        pick(PIECES),
      ).join('');
      const marks = MARKS.filter(() => random() < 0.18).map((type) =>
        type === 'link' ? { type, attrs: { href: pick(HREFS) } } : { type },
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
  return Array.from({ length: count }, () => ({
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

/** Each character's marks, in document order. */
function marksByCharacter(node: JSONContent): string[][] {
  if (node.type === 'text')
    return [...(node.text ?? '')].map(() =>
      (node.marks ?? []).map(
        (mark) => `${mark.type} ${mark.attrs?.href ?? ''}`,
      ),
    );
  if (node.type === 'hardBreak') return [[]];
  return (node.content ?? []).flatMap(marksByCharacter);
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
 * The three shapes whose markers the stripper keeps (a database follow-up,
 * like `\<`): a quote inside a quote or a list item, and an item that opens
 * with no words of its own.
 */
function stripperKeepsMarkers(
  node: JSONContent,
  inQuote = false,
  inItem = false,
): boolean {
  if (node.type === 'blockquote' && (inQuote || inItem)) return true;
  if (node.type === 'listItem' && !node.content?.[0]?.content?.length)
    return true;
  return (node.content ?? []).some((child) =>
    stripperKeepsMarkers(
      child,
      inQuote || node.type === 'blockquote',
      inItem || node.type === 'listItem',
    ),
  );
}

/** No spaces and no backslashes: `\<` and literal backslashes aside, the same words. */
const squashed = (value: string) => value.replace(/[\s\\]/g, '');

describe('any document, written (ruling 21)', () => {
  const cases = documents(20261021, 400);
  // Written once, read by every check below.
  let memo: { json: JSONContent; markdown: string; back: JSONContent }[] = [];
  const written = () => {
    if (!memo.length)
      memo = cases.map((json) => {
        const markdown = serializeFormattedText(json);
        return { json, markdown, back: parseFormattedText(markdown) };
      });
    return memo;
  };

  it('writes text that writes again byte for byte the same', () => {
    for (const { markdown, back } of written())
      expect(serializeFormattedText(back)).toBe(markdown);
  });

  it('reads back as its normalised document, its words and blocks whole', () => {
    for (const { json, back } of written())
      expect(bare(back)).toEqual(bare(normalizeFormattedText(json)));
  });

  it('only ever drops a mark, and never adds one', () => {
    for (const { json, back } of written()) {
      const intended = marksByCharacter(normalizeFormattedText(json));
      marksByCharacter(back).forEach((marks, index) => {
        for (const mark of marks) expect(intended[index]).toContain(mark);
      });
    }
  });

  it('gives the stripper the document’s words', () => {
    let checked = 0;
    for (const { json, markdown } of written()) {
      const normal = normalizeFormattedText(json);
      if (stripperKeepsMarkers(normal)) continue;
      checked += 1;
      expect(squashed(toPlainText(markdown))).toBe(squashed(words(normal)));
    }
    expect(checked).toBeGreaterThan(200);
  });
});
