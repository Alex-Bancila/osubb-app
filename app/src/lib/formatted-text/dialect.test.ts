import type { Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { isDialectHeading, isWrittenTextLink } from './dialect';
import { lexFormattedText } from './lex';

/** The first token of `markdown`'s first block, or that block. */
function first(markdown: string, inline: boolean): Tokens.Generic {
  const [block] = lexFormattedText(markdown) as Tokens.Generic[];
  const token = inline ? block?.tokens?.[0] : block;
  if (!token) throw new Error(`no token in ${markdown}`);
  return token;
}

describe('the dialect questions the reader and the editor share (ruling 26)', () => {
  it.each([
    ['# Titlu', true],
    ['## Subtitlu', true],
    ['#', true],
    ['Titlu\n===', false],
    ['#voluntariat\n---', false],
  ])('reads %j as a Titlu written with #: %s', (markdown, expected) => {
    expect(isDialectHeading(first(markdown, false) as Tokens.Heading)).toBe(
      expected,
    );
  });

  it.each([
    ['[formular](https://forms.gle/x)', true],
    ['https://forms.gle/x', true],
    ['[](https://forms.gle/x)', false],
    ['<https://forms.gle/x>', false],
    ['www.osubb.ro', false],
    ['a@b.ro', false],
  ])('reads %j as a written Text Link: %s', (markdown, expected) => {
    expect(isWrittenTextLink(first(markdown, true) as Tokens.Link)).toBe(
      expected,
    );
  });
});
