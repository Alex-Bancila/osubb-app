import { describe, expect, it } from 'vitest';
import { lexFormattedText } from '../../../lib/formatted-text/lex';
import { whatsappToMarkdown } from './whatsapp';

describe('whatsappToMarkdown (ruling R60, decision 14)', () => {
  it('turns *bold*, _italic_ and ~tăiat~ at word boundaries into the dialect', () => {
    expect(whatsappToMarkdown('*Ședința* e _joi_ ~nu~')).toBe(
      '**Ședința** e *joi* ~~nu~~',
    );
  });

  it('keeps a marker between two letters or digits as text', () => {
    expect(whatsappToMarkdown('5*3*2')).toBe('5\\*3\\*2');
    expect(whatsappToMarkdown('nume_prenume_x')).toBe('nume\\_prenume\\_x');
    expect(whatsappToMarkdown('ăla*b* și*c*')).toBe('ăla\\*b\\* și\\*c\\*');
  });

  it('keeps a marker with a space just inside it as text', () => {
    expect(whatsappToMarkdown('a * b * c')).toBe('a \\* b \\* c');
    expect(whatsappToMarkdown('*a *')).toBe('\\*a \\*');
  });

  it('escapes every other marker of the dialect, so a paste adds no formatting', () => {
    expect(whatsappToMarkdown('2 == 2, [x] `cod` <b> a\\b ~')).toBe(
      '2 \\=\\= 2, \\[x\\] \\`cod\\` \\<b> a\\\\b \\~',
    );
  });

  it('keeps a list at the start of a line', () => {
    expect(whatsappToMarkdown('Ordinea:\n- unu\n1. doi')).toBe(
      'Ordinea:\n- unu\n1. doi',
    );
  });

  it('converts nested markers, and never across a line break', () => {
    expect(whatsappToMarkdown('*Atenție: _mâine_*')).toBe(
      '**Atenție: *mâine***',
    );
    expect(whatsappToMarkdown('*a\nb*')).toBe('\\*a\nb\\*');
  });

  it('leaves an address as it is, so the reader links all of it', () => {
    const address = 'https://forms.gle/a_b*c~d=e';
    expect(whatsappToMarkdown(`Formular: ${address}`)).toBe(
      `Formular: ${address}`,
    );
    expect(whatsappToMarkdown(`*${address}*.`)).toBe(`**${address}**.`);
    const [paragraph] = lexFormattedText(whatsappToMarkdown(address));
    expect(paragraph).toMatchObject({
      tokens: [{ type: 'link', href: address }],
    });
  });

  it('folds Windows line ends', () => {
    expect(whatsappToMarkdown('*a*\r\n_b_')).toBe('**a**\n*b*');
  });
});
