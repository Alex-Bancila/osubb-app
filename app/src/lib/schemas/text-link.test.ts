import { expect, it } from 'vitest';
import { expectRoutable, issues } from '../../test/schema-issues';
import { fieldForReason, textLinkSchema } from './text-link';

const check = (text: string, url: string) => {
  const result = textLinkSchema.safeParse({ text, url });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('trims the words and the address', () => {
  expect(
    textLinkSchema.parse({ text: ' Formular ', url: ' https://osubb.ro ' }),
  ).toEqual({ text: 'Formular', url: 'https://osubb.ro' });
});

it('takes an http(s) address, with or without words', () => {
  expect(check('', 'https://osubb.ro/anunturi')).toEqual([]);
  expect(check('Formular', 'http://forms.gle/x')).toEqual([]);
  expect(check('Formular', 'HTTPS://osubb.ro')).toEqual([]);
});

it('refuses an address the reader would not link', () => {
  for (const url of ['', 'osubb.ro', 'www.osubb.ro', 'javascript:alert(1)'])
    expect(check('Formular', url), url).toEqual(['url: link_url_invalid']);
});
