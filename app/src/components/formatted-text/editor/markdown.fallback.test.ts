import type { JSONContent } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { parseFormattedText, serializeFormattedText } from './markdown';

/**
 * The writer's last check, on the whole text (fix round 1). Every case found
 * so far is fixed where it starts, so none reaches it; this lexer has one
 * made-up flaw to show the check and its fallback work. Read whole, a text
 * holding an unescaped `%%` in one block loses every block after it, as
 * `<!--` once hid the paragraphs after it. Read alone, a line or a paragraph
 * reads as usual, so only the whole-text check sees the difference.
 */
vi.mock('../../../lib/formatted-text/lex', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/formatted-text/lex')>();
  return {
    lexFormattedText: (markdown: string) => {
      const tokens = actual.lexFormattedText(markdown);
      const hides = /(?:^|[^\\])%%/.test(markdown) && markdown.includes('\n\n');
      return hides ? tokens.slice(0, 1) : tokens;
    },
  };
});

const paragraph = (
  text: string,
  ...marks: { type: string }[]
): JSONContent => ({
  type: 'paragraph',
  content: [
    marks.length ? { type: 'text', text, marks } : { type: 'text', text },
  ],
});

describe('the whole-text check (ruling 21, fix round 1)', () => {
  it('writes a block the whole text reads differently in its plainest form', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [paragraph('50%% din', { type: 'bold' }), paragraph('după')],
    };
    const markdown = serializeFormattedText(json);
    expect(markdown).toBe('50\\%\\% din\n\ndupă');
    expect(parseFormattedText(markdown)).toEqual({
      type: 'doc',
      content: [paragraph('50%% din'), paragraph('după')],
    });
    expect(serializeFormattedText(parseFormattedText(markdown))).toBe(markdown);
  });

  it('leaves alone a text the whole-text check reads as written', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [paragraph('50%', { type: 'bold' }), paragraph('după')],
    };
    expect(serializeFormattedText(json)).toBe('**50%**\n\ndupă');
  });
});
