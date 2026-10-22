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
      // A `<` opening a line would open an HTML block, which the reader
      // shows raw, escapes and all: it is escaped. The stripper then keeps
      // the backslash (`plain.ts` does not unescape `<`).
      ['raw HTML', '<b>x</b>', '\\<b>x</b>'],
      ['a table', '| a | b |\n|---|---|', '\\| a \\| b \\|\n\\|---\\|---\\|'],
      [
        'a javascript: link',
        '[x](javascript:alert(1))',
        '\\[x\\]\\(javascript:alert(1))',
      ],
      [
        'a www. address and an e-mail',
        'www.osubb.ro și a@b.ro',
        'www\\.osubb.ro și a@b.ro',
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
        ],
      });
      const markdown = written(json);
      expect(markdown).toBe('9. a\n   b\n10. c\n\n    d\n    - e');
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

/**
 * `json` written, then checked as every written text must be: rewriting it is
 * byte for byte the same, and reading it gives the document it was written
 * from, less only the marks the dialect cannot hold.
 */
function stableWrite(json: JSONContent): string {
  const markdown = written(json);
  expect(rewritten(markdown)).toBe(markdown);
  return markdown;
}

describe('cases the task review found (fix round 1)', () => {
  it('drops an empty nested item, whose lone - would underline the words above it', () => {
    const markdown = stableWrite(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph(text('Important', bold), text(': vineri')),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [paragraph()] }],
              },
            ],
          },
        ],
      }),
    );
    expect(markdown).toBe('- **Important**: vineri');
    expect(reader(markdown)).toContain(
      '<li><strong>Important</strong>: vineri</li>',
    );
  });

  it('keeps a nested list whose first item opens with a list a line below the words', () => {
    const nested = (content: JSONContent[]): JSONContent => ({
      type: 'bulletList',
      content: [{ type: 'listItem', content }],
    });
    const json = doc(
      nested([
        paragraph(text('a')),
        nested([paragraph(), nested([paragraph(text('b'))])]),
      ]),
    );
    const markdown = stableWrite(json);
    expect(markdown).toBe('- a\n\n  -\n    - b');
    expect(parseFormattedText(markdown)).toEqual(json);
  });

  it.each([
    ['[vezi https://x.ro]', '\\[vezi [https://x.ro](https://x.ro)\\]'],
    ['https://x.ro*', '[https://x.ro](https://x.ro)\\*'],
    ['https://x.ro/a~', '[https://x.ro/a](https://x.ro/a)\\~'],
    ['vezi https://x.ro.', 'vezi https://x.ro.'],
    [
      'http://y.ro:_= și http://z.ro',
      '[http://y.ro](http://y.ro):\\_= și http://z.ro',
    ],
  ])(
    'links the address in %s where the reader’s link ends',
    (words, markdown) => {
      expect(stableWrite(doc(paragraph(text(words))))).toBe(markdown);
      expect(toPlainText(markdown)).toBe(words);
      expect(reader(markdown)).not.toContain('\\');
    },
  );

  it.each(['<div>', '<p>', '<br>', '<!x', '<script>x', '</b>'])(
    'escapes %s opening a line, which would open an HTML block',
    (words) => {
      const markdown = stableWrite(doc(paragraph(text('a'), br, text(words))));
      expect(markdown).toBe(`a\n\\${words}`);
      expect(reader(markdown)).toContain(
        words.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      );
    },
  );

  it('keeps <!-- from hiding the paragraphs after it', () => {
    const markdown = stableWrite(
      doc(paragraph(text('<!-- notă **a**')), paragraph(text('după', bold))),
    );
    expect(markdown).toBe('\\<!-- notă \\*\\*a\\*\\*\n\n**după**');
    expect(reader(markdown)).toContain('<p><strong>după</strong></p>');
  });

  it('escapes the ( after an escaped ], which the stripper would read as a Text Link', () => {
    const markdown = stableWrite(
      doc(paragraph(text('![img](https://x.ro/i.png)'))),
    );
    expect(markdown).toBe('!\\[img\\]\\(https://x.ro/i.png)');
    expect(toPlainText(markdown)).toBe('![img](https://x.ro/i.png)');
    expect(rewritten('![img](https://x.ro/i.png)')).toBe(markdown);
  });

  it('writes a line plainer when marked would pair its marker with the next line’s', () => {
    const json = doc(
      paragraph(text('[<', italic), br, text('*'), text(':x\\>', bold)),
    );
    const markdown = stableWrite(json);
    expect(markdown).toBe('\\[<\n\\***:x\\\\>**');
    expect(reader(markdown)).toBe(
      '<div class="formatted-text"><p>[&lt;<br>*<strong>:x\\&gt;</strong></p></div>',
    );
    expect(toPlainText(markdown)).toBe('[<\n*:x\\>');
  });

  it('escapes a spaced rule under words', () => {
    const markdown = stableWrite(doc(paragraph(text('a'), br, text('-- -'))));
    expect(markdown).toBe('a\n\\-- -');
    expect(reader(markdown)).toBe(
      '<div class="formatted-text"><p>a<br>-- -</p></div>',
    );
  });

  it('escapes the dot of a www. address, which marked would run on through the markers after it', () => {
    const markdown = stableWrite(
      doc(paragraph(text('vezi www.osubb.ro'), text('acum', bold))),
    );
    expect(markdown).toBe('vezi www\\.osubb.ro**acum**');
    expect(toPlainText(markdown)).toBe('vezi www.osubb.roacum');
    expect(reader(markdown)).toContain('www.osubb.ro<strong>acum</strong>');
  });
});

describe('a mark comes off the fewest characters (fix round 1)', () => {
  it('takes a Text Link off only the brackets in its words', () => {
    const json = doc(
      paragraph(text('[PDF] Regulament', link('https://x.ro/r.pdf'))),
    );
    const markdown = stableWrite(json);
    expect(markdown).toBe(
      '\\[[PDF](https://x.ro/r.pdf)\\] [Regulament](https://x.ro/r.pdf)',
    );
    const html = reader(markdown);
    expect(html).toMatch(
      /^<div class="formatted-text"><p>\[<a href="https:\/\/x\.ro\/r\.pdf"[^>]*>PDF<span/,
    );
    expect(html).toMatch(
      /<\/a>\] <a href="https:\/\/x\.ro\/r\.pdf"[^>]*>Regulament<span/,
    );
    expect(toPlainText(markdown)).toBe('[PDF] Regulament');
  });

  it('keeps the address of a link whose words end in brackets', () => {
    const markdown = stableWrite(
      doc(paragraph(text('a[b]', link('https://x.ro')))),
    );
    expect(markdown).toBe('[a](https://x.ro)\\[[b](https://x.ro)\\]');
    expect(toPlainText(markdown)).toBe('a[b]');
  });

  it('drops a Text Link last, since an address unlinked is linked again when read', () => {
    // Found by the property test: dropping the link first wrote
    // `https\://x.ro/a\* \[ș)`, which read back as a link and was then
    // written differently.
    const markdown = stableWrite(
      doc(
        paragraph(
          text('https://x.ro/a* [', italic),
          text('ș'),
          text(')', italic),
        ),
      ),
    );
    expect(markdown).toBe('[https://x.ro/a](https://x.ro/a)\\* \\[ș)');
    expect(toPlainText(markdown)).toBe('https://x.ro/a* [ș)');
  });

  it.each([
    ['italic', italic, '!', 'http://x.ro!'],
    ['strike', strike, '*', 'http://b.ro*'],
  ])(
    'links an address once a dropped %s leaves its marks the same (fix round 2)',
    (_, mark, after, words) => {
      // Found by the task re-review: the address stopped where its marks
      // changed, the writer then dropped the mark that changed, and the
      // address was saved unlinked once and linked the next time.
      const [scheme = '', host = ''] = words.slice(0, -1).split(/(?<=\/\/)/);
      const markdown = stableWrite(
        doc(paragraph(text(scheme, mark), text(host), text(after, bold))),
      );
      expect(markdown).not.toContain('\\:');
      expect(toPlainText(markdown)).toBe(words);
      const back = parseFormattedText(markdown).content?.[0]?.content ?? [];
      expect(back[0]).toEqual(
        text(words.slice(0, -1), link(words.slice(0, -1))),
      );
    },
  );

  it.each([
    ['a <!-- b_c --> d', 'a \\<!-- b\\_c --> d'],
    ['x <span class="a_b">y', 'x \\<span class="a\\_b">y'],
    ['Q&A <b>x</b> 1 < 2', 'Q&A <b>x</b> 1 < 2'],
  ])(
    'escapes every < opening a tag on a line whose raw HTML holds a marker, as in %j (fix round 2)',
    (words, markdown) => {
      // The reader shows raw HTML as typed, escapes and all.
      expect(stableWrite(doc(paragraph(text(words))))).toBe(markdown);
      expect(reader(markdown)).toContain(
        words
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'),
      );
      // The stripper keeps the backslash before `<` (a database follow-up).
      expect(toPlainText(markdown)).toBe(markdown.replace(/\\_/g, '_'));
    },
  );

  it.each([
    [
      paragraph(text('vezi http://'), text('x.ro', bold)),
      'vezi http://**x.ro**',
    ],
    [paragraph(text('http://'), text('1', strike)), 'http://~~1~~'],
  ])(
    'escapes no : where a marker already ends the address (fix round 2)',
    (block, markdown) => {
      expect(stableWrite(doc(block))).toBe(markdown);
      expect(toPlainText(markdown)).not.toContain('\\');
    },
  );

  it.each([
    [
      paragraph(text('site', link('https://x.ro/a')), text(' ftp://x.ro/a_b')),
      '[site](https://x.ro/a) ftp\\://x.ro/a\\_b',
    ],
    [
      paragraph(
        text('vezi', bold),
        text(' '),
        text('formular', link('https://forms.gle/x')),
        text(' sau ftp://x.ro/a_b'),
      ),
      '**vezi** [formular](https://forms.gle/x) sau ftp\\://x.ro/a\\_b',
    ],
    [
      paragraph(
        text('a', link('https://x.ro/a')),
        text(' si '),
        text('b', link('https://x.ro/b')),
        text(' ftp://x.ro/~u'),
      ),
      '[a](https://x.ro/a) si [b](https://x.ro/b) ftp\\://x.ro/\\~u',
    ],
  ])(
    'keeps every mark beside an ftp:// address, which marked reads as one (fix round 3)',
    (block, markdown) => {
      // The reader shows an ftp:// address marked reads as typed, escapes
      // and all; its `:` is escaped so marked reads none.
      expect(stableWrite(doc(block))).toBe(markdown);
      const html = reader(markdown);
      expect(html).toContain('</a>');
      expect(html).toMatch(/ftp:\/\/x\.ro\/(a_b|~u)<\/p>/);
      // The stripper shows that `\:` (a database follow-up).
      expect(toPlainText(markdown)).toContain('ftp\\://x.ro/');
    },
  );

  it('writes an ftp:// address with no marker in it as it is (fix round 3)', () => {
    const markdown = stableWrite(
      doc(
        paragraph(text('site', link('https://x.ro/a')), text(' ftp://x.ro/a')),
      ),
    );
    expect(markdown).toBe('[site](https://x.ro/a) ftp://x.ro/a');
    expect(toPlainText(markdown)).toBe('site ftp://x.ro/a');
  });

  it('takes bold off the punctuation that ends it before a letter', () => {
    const markdown = stableWrite(doc(paragraph(text('x.', bold), text('a'))));
    expect(markdown).toBe('**x**.a');
    expect(reader(markdown)).toContain('<strong>x</strong>.a');
    expect(toPlainText(markdown)).toBe('x.a');
  });

  it('keeps bold and drops italic right after it, where no form reads the same in both', () => {
    // The reader reads both forms as bold then italic; the stripper keeps
    // the italic's markers in each.
    expect(toPlainText('**a***b*')).toBe('a*b*');
    expect(toPlainText('**a**_b_')).toBe('a_b_');
    const markdown = stableWrite(
      doc(paragraph(text('a', bold), text('b', italic))),
    );
    expect(markdown).toBe('**a**b');
    expect(toPlainText(markdown)).toBe('ab');
  });
});
