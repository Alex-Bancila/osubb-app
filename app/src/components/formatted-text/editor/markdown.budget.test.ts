// @vitest-environment node
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LINE_CHECKS,
  parseFormattedText,
  serializeFormattedText,
} from './markdown';

/**
 * The writer's search has a budget (ruling 27): the editor writes its whole
 * text on every change, and a line with many marks the dialect cannot hold
 * once took a minute. The budget is counted here as the lexer counts it,
 * since every way of writing a line that is checked is lexed once.
 */
const lexed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../../lib/formatted-text/lex', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/formatted-text/lex')>();
  return {
    lexFormattedText: (markdown: string) => {
      lexed.calls += 1;
      return actual.lexFormattedText(markdown);
    },
  };
});

afterEach(() => {
  lexed.calls = 0;
});

const text = (value: string, ...marks: JSONContent['marks'] & object) =>
  marks.length
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value };

/**
 * A line of 60 runs, each italic inside a word (`a*b*c`), which the dialect
 * cannot hold, so no run can be written as typed, and a Text Link among
 * them.
 */
function pathological(): JSONContent {
  const content: JSONContent[] = [
    text('site', { type: 'link', attrs: { href: 'https://x.ro/a' } }),
    text(' '),
  ];
  for (let index = 0; index < 60; index += 1)
    content.push(text('a'), text(`b${index}`, { type: 'italic' }));
  content.push(text('c'));
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

describe('the search’s budget (ruling 27)', () => {
  it('reads back at most its budget of ways, and a few more checks', () => {
    const markdown = serializeFormattedText(pathological());
    // The line's search, then its last resort (one way, no marks but the
    // link), the paragraph read whole and the text read whole.
    expect(lexed.calls).toBeGreaterThan(LINE_CHECKS);
    expect(lexed.calls).toBeLessThanOrEqual(LINE_CHECKS + 12);
    expect(LINE_CHECKS).toBeLessThanOrEqual(32);
    expect(markdown.startsWith('[site](https://x.ro/a) ')).toBe(true);
  });

  it('keeps the Text Link on its last resort, and saves the same way twice', () => {
    const markdown = serializeFormattedText(pathological());
    const back = parseFormattedText(markdown);
    expect(back.content?.[0]?.content?.[0]).toEqual(
      text('site', { type: 'link', attrs: { href: 'https://x.ro/a' } }),
    );
    expect(serializeFormattedText(back)).toBe(markdown);
  });

  it('reads a line written as typed once, then its paragraph and its text', () => {
    serializeFormattedText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('Ne vedem '),
            text('joi', { type: 'bold' }),
            text('.'),
          ],
        },
      ],
    });
    // The line, the paragraph and the text, each read once.
    expect(lexed.calls).toBe(3);
  });
});
