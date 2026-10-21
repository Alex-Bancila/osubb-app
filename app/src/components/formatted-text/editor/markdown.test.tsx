import type { JSONContent } from '@tiptap/core';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { toPlainText } from '../../../lib/formatted-text/plain';
import { FormattedText } from '../FormattedText';
import { parseFormattedText, serializeFormattedText } from './markdown';

/** What the reader shows for `markdown`, as HTML. */
function reader(markdown: string): string {
  return render(
    <MemoryRouter>
      <FormattedText text={markdown} view="full" />
    </MemoryRouter>,
  ).container.innerHTML;
}

/** `markdown` read by the editor and written back. */
function rewritten(markdown: string): string {
  return serializeFormattedText(parseFormattedText(markdown));
}

const text = (
  value: string,
  ...marks: NonNullable<JSONContent['marks']>
): JSONContent =>
  marks.length
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value };
const bold = { type: 'bold' };
const italic = { type: 'italic' };
const strike = { type: 'strike' };
const highlight = { type: 'highlight' };
const link = (href: string) => ({ type: 'link', attrs: { href } });
const br: JSONContent = { type: 'hardBreak' };
const paragraph = (...content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content,
});

/** The Markdown the editor writes for the document `json`. */
function written(json: JSONContent): string {
  return serializeFormattedText(json);
}

/**
 * Texts the editor writes exactly as they are: read and written back, each is
 * byte for byte the same, and reading it again gives the same document.
 */
const CANONICAL: Record<string, string> = {
  'the spec sample':
    'Ne vedem **joi**.\n\n## Ordinea de zi\n\n- unu\n- doi\n\n> citat\n\n==nou== ~~vechi~~ [formular](https://forms.gle/x)',
  'a line break': 'Rândul 1\nRândul 2',
  'both titles': '# Titlu\n\n## Subtitlu\n\ntext',
  'a nested bulleted list': '- unu\n  - doi\n- trei',
  'a numbered list holding a bulleted one': '1. unu\n   - doi\n2. trei',
  'a numbered list from 3': '3. trei\n4. patru',
  'a quote of two paragraphs': '> citat\n>\n> doi',
  'a list in a quote': '> - a\n> - b',
  'an item opening with a Titlu': '-\n  # Titlu',
  'every inline style': '**a** *b* ~~c~~ ==d== [e](https://x.ro)',
  'italic inside bold, written with _': '**a _b_ c**',
  'bold inside italic': '*a **b***',
  'a bare address': 'Formular: https://forms.gle/x',
  'stars and underscores inside words': '5\\*3\\*2 și nume\\_prenume',
  'HTML and entities, as typed': 'Q&A <b>x</b> &amp; 1 < 2',
  'block markers kept as text':
    '\\# nu e titlu\n\\- nici listă\n1\\. nici asta\n\\> nici citat',
  'equals signs': 'a = b și 2 \\=\\= 2',
  'a pipe': 'a \\| b',
  'a link whose address has parentheses': '[w](https://x.ro/a%28y%29)',
  'Romanian marks around words': '**Ședința** *și* ~~țară~~ ==ăla==',
};

describe('the editor’s Markdown (ruling R60, ruling 21)', () => {
  it.each(Object.entries(CANONICAL))(
    'writes %s back byte for byte',
    (_, markdown) => {
      expect(rewritten(markdown)).toBe(markdown);
      expect(parseFormattedText(rewritten(markdown))).toEqual(
        parseFormattedText(markdown),
      );
    },
  );

  it('reads the spec sample as the reader and the stripper do', () => {
    const sample = CANONICAL['the spec sample'] ?? '';
    expect(parseFormattedText(sample)).toEqual(
      doc(
        paragraph(text('Ne vedem '), text('joi', bold), text('.')),
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [text('Ordinea de zi')],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph(text('unu'))] },
            { type: 'listItem', content: [paragraph(text('doi'))] },
          ],
        },
        { type: 'blockquote', content: [paragraph(text('citat'))] },
        paragraph(
          text('nou', highlight),
          text(' '),
          text('vechi', strike),
          text(' '),
          text('formular', link('https://forms.gle/x')),
        ),
      ),
    );
    const html = reader(sample);
    expect(html).toContain('<strong>joi</strong>');
    expect(html).toContain('<h4>Ordinea de zi</h4>');
    expect(html).toContain('<mark>nou</mark> <s>vechi</s>');
    expect(html).toContain('href="https://forms.gle/x"');
    expect(toPlainText(sample)).toBe(
      'Ne vedem joi.\n\nOrdinea de zi\n\n• unu\n• doi\n\ncitat\n\nnou vechi formular',
    );
  });

  describe('a mark never spans a line break', () => {
    it.each([
      ['bold', bold, '**a**\n**b**'],
      ['italic', italic, '*a*\n*b*'],
      ['strike', strike, '~~a~~\n~~b~~'],
      ['highlight', highlight, '==a==\n==b=='],
    ])('closes %s before the break and opens it after', (_, mark, markdown) => {
      const json = doc(
        paragraph(text('a', mark), { ...br, marks: [mark] }, text('b', mark)),
      );
      expect(written(json)).toBe(markdown);
      expect(reader(markdown)).toMatch(
        /^<div class="formatted-text"><p><(\w+)>a<\/\1><br><\1>b<\/\1><\/p><\/div>$/,
      );
      expect(toPlainText(markdown)).toBe('a\nb');
    });

    it('closes only the mark that ends at the break', () => {
      expect(written(doc(paragraph(text('a b', bold), br, text('c'))))).toBe(
        '**a b**\nc',
      );
    });
  });

  describe('texts written before the editor', () => {
    it.each([
      ['a star list', '* a\n* b', '- a\n- b'],
      ['_italic_', '_cursiv_', '*cursiv*'],
      ['single-tilde strike', '~tăiat~', '~~tăiat~~'],
      ['a deeper title', '### Mic', '## Mic'],
      [
        'a link that shows its address',
        '[https://x.ro](https://x.ro)',
        'https://x.ro',
      ],
      ['two trailing spaces before a break', 'a  \nb', 'a\nb'],
      ['blank lines', 'a\n\n\n\nb', 'a\n\nb'],
      ['a code fence', '```\ncod\n```', '\\`\\`\\`\ncod\n\\`\\`\\`'],
      ['inline code', 'un `cod`', 'un \\`cod\\`'],
      ['raw HTML', '<b>x</b>', '<b>x</b>'],
      ['a table', '| a | b |\n|---|---|', '\\| a \\| b \\|\n\\|---\\|---\\|'],
      [
        'a javascript: link',
        '[x](javascript:alert(1))',
        '\\[x\\](javascript:alert(1))',
      ],
      [
        'a www. address and an e-mail',
        'www.osubb.ro și a@b.ro',
        'www.osubb.ro și a@b.ro',
      ],
      ['a checklist box', '- [ ] sarcină', '- \\[ \\] sarcină'],
      ['an underlined heading', 'Setext\n===', 'Setext\n\\=\\=\\='],
      ['a rule', '---', '\\---'],
      // An underline makes the words above it a heading the reader shows as
      // typed, stars and all; the editor reads it the same way.
      ['a rule under words', '**a**\n---', '\\*\\*a\\*\\*\n\\---'],
      ['a lone equals sign under words', '**a**\n=', '\\*\\*a\\*\\*\n\\='],
    ])('keeps how %s reads', (_, before, after) => {
      expect(rewritten(before)).toBe(after);
      expect(reader(after)).toBe(reader(before));
      expect(rewritten(after)).toBe(after);
    });

    it('keeps the stripper’s words where the reader’s are kept', () => {
      for (const before of [
        '* a\n* b',
        '_cursiv_',
        '```\ncod\n```',
        '| a | b |',
        '- [ ] x',
      ])
        expect(toPlainText(rewritten(before))).toBe(toPlainText(before));
    });

    it('reads an empty text as one empty paragraph and writes nothing', () => {
      expect(parseFormattedText('')).toEqual(doc(paragraph()));
      expect(rewritten('')).toBe('');
      expect(rewritten('   \n\n  ')).toBe('');
    });
  });

  describe('what the dialect cannot hold is written as words', () => {
    it.each([
      [
        'italic inside a word',
        paragraph(text('5'), text('3', italic), text('2')),
        '532',
      ],
      ['bold around a literal star', paragraph(text('a*b', bold)), 'a\\*b'],
      [
        'highlight around an equals sign',
        paragraph(text('a = b', highlight)),
        'a = b',
      ],
      ['strike around a tilde', paragraph(text('a~b', strike)), 'a\\~b'],
      [
        'bold closing on punctuation before a letter',
        paragraph(text('x.', bold), text('a')),
        'x.a',
      ],
      [
        'a link with brackets in its words',
        paragraph(text('a[b]', link('https://x.ro'))),
        'a\\[b\\]',
      ],
      [
        'a link to a refused address',
        paragraph(text('rău', link('javascript:alert(1)'))),
        'rău',
      ],
    ])('%s', (_, block, markdown) => {
      const json = doc(block);
      expect(written(json)).toBe(markdown);
      expect(toPlainText(markdown)).toBe(
        (block.content ?? []).map((node) => node.text).join(''),
      );
    });

    it('keeps bold inside a word, which both readers read', () => {
      const markdown = written(
        doc(paragraph(text('5'), text('3', bold), text('2'))),
      );
      expect(markdown).toBe('5**3**2');
      expect(reader(markdown)).toContain('5<strong>3</strong>2');
      expect(toPlainText(markdown)).toBe('532');
    });
  });

  describe('spaces and line breaks', () => {
    it('moves spaces at the edge of a mark outside it', () => {
      expect(
        written(doc(paragraph(text('a '), text(' b ', bold), text('c')))),
      ).toBe('a  **b** c');
      expect(
        written(doc(paragraph(text('a'), text(' ', bold), text('b')))),
      ).toBe('a b');
    });

    it('drops breaks at the edges, and splits a paragraph at an empty line', () => {
      expect(
        written(doc(paragraph(br, text('a'), br, br, text('b'), br))),
      ).toBe('a\n\nb');
    });

    it('trims each line', () => {
      expect(written(doc(paragraph(text('  a  '), br, text('\tb'))))).toBe(
        'a\nb',
      );
    });

    it('drops empty paragraphs, headings and quotes', () => {
      expect(
        written(
          doc(
            paragraph(),
            paragraph(text('a')),
            paragraph(),
            paragraph(),
            { type: 'heading', attrs: { level: 1 } },
            { type: 'blockquote', content: [paragraph()] },
            paragraph(text('b')),
          ),
        ),
      ).toBe('a\n\nb');
    });
  });

  describe('titles, quotes and lists', () => {
    it('writes a Titlu ending in # so the # stays a word', () => {
      const json = doc({
        type: 'heading',
        attrs: { level: 1 },
        content: [text('Limbajul C #')],
      });
      expect(written(json)).toBe('# Limbajul C \\#');
      expect(reader('# Limbajul C \\#')).toContain('<h3>Limbajul C #</h3>');
      expect(toPlainText('# Limbajul C \\#')).toBe('Limbajul C #');
    });

    it('writes a line break inside a title as a space', () => {
      const json = doc({
        type: 'heading',
        attrs: { level: 2 },
        content: [text('a'), br, text('b')],
      });
      expect(written(json)).toBe('## a b');
    });

    it('indents an item’s later lines under its words', () => {
      const json = doc({
        type: 'orderedList',
        attrs: { start: 9 },
        content: [
          { type: 'listItem', content: [paragraph(text('a'), br, text('b'))] },
          {
            type: 'listItem',
            content: [
              paragraph(text('c')),
              paragraph(text('d')),
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [paragraph(text('e'))] },
                ],
              },
            ],
          },
          { type: 'listItem', content: [paragraph()] },
        ],
      });
      const markdown = written(json);
      expect(markdown).toBe('9. a\n   b\n10. c\n\n    d\n    - e\n11.');
      expect(parseFormattedText(markdown)).toEqual(json);
    });

    it('writes a quote line by line', () => {
      const json = doc({
        type: 'blockquote',
        content: [
          paragraph(text('a'), br, text('b')),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph(text('c'))] }],
          },
        ],
      });
      expect(written(json)).toBe('> a\n> b\n>\n> - c');
    });

    it('escapes an ! right before a Text Link', () => {
      const markdown = written(
        doc(
          paragraph(text('Atenție!'), text('formular', link('https://x.ro'))),
        ),
      );
      expect(markdown).toBe('Atenție\\![formular](https://x.ro)');
      expect(reader(markdown)).toContain('Atenție!<a');
      expect(toPlainText(markdown)).toBe('Atenție!formular');
    });
  });
});
