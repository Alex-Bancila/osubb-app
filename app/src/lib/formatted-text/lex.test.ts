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

  // Ruling 17: "inside a word" is the stripper's word class, not every
  // letter, so a star between two Cyrillic letters pairs as it does there.
  it('reads in-word stars with the stripper’s word class', () => {
    expect(toPlainText('д*д*д')).toBe('ддд');
    expect(firstLine('д*д*д').map((token) => token.type)).toEqual([
      'text',
      'em',
      'text',
    ]);
    expect(toPlainText('ș*ț*ă')).toBe('ș*ț*ă');
    expect(types('ș*ț*ă')).not.toContain('em');
  });
});

/** How many containers open, one inside the other, from the first token. */
function depth(tokens: readonly Token[]): number {
  const [first] = tokens as Tokens.Generic[];
  if (first?.type === 'blockquote') return 1 + depth(first.tokens ?? []);
  if (first?.type === 'list') return 1 + depth(first.items?.[0]?.tokens ?? []);
  return 0;
}

/** The words where the nesting stops. */
function innermost(tokens: readonly Token[]): string {
  const [first] = tokens as Tokens.Generic[];
  if (first?.type === 'blockquote') return innermost(first.tokens ?? []);
  if (first?.type === 'list') return innermost(first.items?.[0]?.tokens ?? []);
  return flatten(first?.tokens ?? [])
    .filter((token) => !token.tokens)
    .map((token) => token.text)
    .join('');
}

describe('lexFormattedText nesting (ruling 16)', () => {
  it('survives 5000 quote markers, nesting no deeper than 8', () => {
    const markdown = '>'.repeat(5000) + 'x';
    expect(() => lexFormattedText(markdown)).not.toThrow();
    expect(depth(lexFormattedText(markdown))).toBe(8);
    expect(innermost(lexFormattedText(markdown))).toBe('>'.repeat(4992) + 'x');
  });

  it.each([
    ['quotes', '> '.repeat(12) + 'x', '> > > > x'],
    ['bullets', '- '.repeat(12) + 'x', '- - - - x'],
    ['numbers', '1. '.repeat(12) + 'x', '1. 1. 1. 1. x'],
    ['quotes and bullets', '> - '.repeat(6) + 'x', '> - > - x'],
  ])('stops %s at depth 8 and shows the rest as text', (_, markdown, rest) => {
    const tokens = lexFormattedText(markdown);
    expect(depth(tokens)).toBe(8);
    expect(innermost(tokens)).toBe(rest);
  });

  it('nests 8 deep as written', () => {
    expect(depth(lexFormattedText('> '.repeat(8) + 'x'))).toBe(8);
    expect(innermost(lexFormattedText('- '.repeat(8) + 'x'))).toBe('x');
  });

  it('leaves a spaced rule alone', () => {
    expect(types('- - - - - - - - - - - -')).toEqual(['hr']);
  });

  it('shows a capped line as typed, with no escape of its own', () => {
    const tokens = lexFormattedText(
      '>'.repeat(9) + 'x\n' + '>'.repeat(8) + '===',
    );
    expect(depth(tokens)).toBe(8);
    const heading = flatten(tokens).find((token) => token.type === 'heading');
    expect(heading?.raw).toBe('>x\n===');
  });
});
