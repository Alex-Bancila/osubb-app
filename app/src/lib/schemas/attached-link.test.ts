import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { attachedLinkSchema, fieldForReason } from './attached-link';

const check = (label: string, url: string) => {
  const result = attachedLinkSchema.safeParse({ label, url });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('takes both or neither, trimmed, and blank as none', () => {
  expect(attachedLinkSchema.parse({ label: '  ', url: '' })).toEqual({
    label: null,
    url: null,
  });
  expect(
    attachedLinkSchema.parse({
      label: ' Formular ',
      url: ' https://osubb.ro ',
    }),
  ).toEqual({ label: 'Formular', url: 'https://osubb.ro' });
  expect(check('Formular', '')).toEqual(['url: link_url_required']);
  expect(check('', 'https://osubb.ro')).toEqual(['label: link_label_required']);
});

it('limits the label to 60 characters', () => {
  expect(check('l'.repeat(60), 'https://osubb.ro')).toEqual([]);
  expect(check('l'.repeat(61), 'https://osubb.ro')).toEqual([
    'label: link_label_too_long',
  ]);
});

// The table of private.is_http_url in constraints_kit.test.sql.
it.each([
  ['https://osubb.ro/formular', []],
  ['  http://osubb.ro  ', []],
  [`https://${'a'.repeat(2040)}`, []],
  [`https://${'a'.repeat(2041)}`, ['url: link_url_too_long']],
  ['ftp://osubb.ro', ['url: link_url_invalid']],
  ['osubb.ro', ['url: link_url_invalid']],
])('reads the address %j as the server does', (url, expected) => {
  expect(check('Formular', url)).toEqual(expected);
});

it('maps every Attached Link reason to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['label', 'url'],
    ['link_label_too_long', 'link_url_invalid', 'link_url_too_long'],
  );
});
