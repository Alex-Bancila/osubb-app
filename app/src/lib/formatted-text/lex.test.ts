import type { Token, Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { lexFormattedText } from './lex';
import { toPlainText } from './plain';

/** The tokens of `markdown`, read without narrowing them by type. */
function lex(markdown: string): Tokens.Generic[] {
  return lexFormattedText(markdown) as Tokens.Generic[];
}

/** Every token of `tokens`, depth first: children, then list items. */
function flatten(tokens: readonly Token[]): Tokens.Generic[] {
  return (tokens as Tokens.Generic[]).flatMap((token) => [
    token,
    ...flatten(token.tokens ?? []),
    ...flatten(token.items ?? []),
  ]);
}

function types(markdown: string): string[] {
  return flatten(lex(markdown)).map((token) => token.type);
}

/** The inline tokens of the first paragraph. */
function firstLine(markdown: string): Token[] {
  const [paragraph] = lex(markdown);
  expect(paragraph?.type).toBe('paragraph');
  return paragraph?.tokens ?? [];
}

describe('lexFormattedText (ruling R60)', () => {
  it('reads a single * between two letters or digits as text', () => {
    expect(firstLine('5*3*2')).toEqual([
      expect.objectContaining({ type: 'text', raw: '5*3*2', text: '5*3*2' }),
    ]);
    expect(types('ăla*b* și nume_prenume')).not.toContain('em');
  });

  it('still reads *x* and _x_ at word edges as italic', () => {
    expect(
      firstLine('*cursiv* și _cursiv_').map((token) => token.type),
    ).toEqual(['em', 'text', 'em']);
  });

  it('reads ==x== as a highlight token', () => {
    expect(firstLine('==x==')).toEqual([
      expect.objectContaining({
        type: 'highlight',
        raw: '==x==',
        text: 'x',
        tokens: [expect.objectContaining({ type: 'text', text: 'x' })],
      }),
    ]);
  });

  it('pairs == only around words: a == b == c is text', () => {
    expect(types('a == b == c')).not.toContain('highlight');
    expect(types('2 ** 3 ** 4')).not.toContain('strong');
  });

  // Ruling 15: the reader pairs `==` exactly where the stripper removes the
  // pair, so each case is checked against `toPlainText` as well.
  it.each([
    ['==nou==', true],
    ['x==y==z', true],
    ['== a==', true],
    ['==a\nb==', false],
    ['==a=b==', false],
    ['==a ==', false],
    ['==\ta==', false],
    ['a == b == c', false],
  ])('pairs %j as the stripper does: %j', (markdown, paired) => {
    expect(toPlainText(markdown) !== markdown).toBe(paired);
    expect(types(markdown).includes('highlight')).toBe(paired);
  });

  it('folds \\r\\n and reads a single line break as a hard break', () => {
    expect(firstLine('a\r\nb').map((token) => token.type)).toEqual([
      'text',
      'br',
      'text',
    ]);
  });

  it('reads ~x~ as strikethrough, like ~~x~~ (ruling 13)', () => {
    expect(firstLine('~tăiat~')).toEqual([
      expect.objectContaining({ type: 'del', text: 'tăiat' }),
    ]);
    expect(firstLine('~~vechi~~')).toEqual([
      expect.objectContaining({ type: 'del', text: 'vechi' }),
    ]);
  });

  it('pairs ~ only at word edges, as the stripper does', () => {
    expect(types('a ~ b ~ c')).not.toContain('del');
    expect(types('5~10 și 20~30')).not.toContain('del');
    expect(firstLine('a~b~c')).toEqual([
      expect.objectContaining({ type: 'text', text: 'a~b~c' }),
    ]);
  });

  it('keeps what it shows as typed free of the escapes it adds', () => {
    expect(firstLine('`5*3`')).toEqual([
      expect.objectContaining({ type: 'codespan', raw: '`5*3`' }),
    ]);
    expect(firstLine('https://osubb.ro/a*b~c')).toEqual([
      expect.objectContaining({
        type: 'link',
        raw: 'https://osubb.ro/a*b~c',
        href: 'https://osubb.ro/a*b~c',
        tokens: [expect.objectContaining({ text: 'https://osubb.ro/a*b~c' })],
      }),
    ]);
    expect(firstLine('[x](https://osubb.ro/a*b)')).toEqual([
      expect.objectContaining({ type: 'link', href: 'https://osubb.ro/a*b' }),
    ]);
  });

  it('honours an escape the Member typed', () => {
    expect(firstLine('\\*nu\\*')).toEqual([
      expect.objectContaining({ type: 'text', text: '*nu*' }),
    ]);
  });

  it('reads a checklist box back as the text it was typed as', () => {
    const [list] = lex('- [ ] sarcină');
    expect(types('- [ ] sarcină')).not.toContain('checkbox');
    expect(flatten(list?.items ?? []).map((token) => token.type)).toEqual([
      'list_item',
      'text',
      'text',
    ]);
    expect(flatten(list?.items ?? []).at(-1)).toEqual(
      expect.objectContaining({ type: 'text', text: '[ ] sarcină' }),
    );
  });
});
