import { describe, expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import {
  attachedLinkSchema,
  attachedLinksFrom,
  attachedLinksSchema,
  fieldForReason,
  linksFieldForReason,
  MAX_ATTACHED_LINKS,
  sameAttachedLinks,
} from './attached-link';

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

describe('attachedLinksSchema (ruling R46)', () => {
  const ok = { label: 'Formular', url: 'https://osubb.ro/f' };
  const listIssues = (links: { label: string; url: string }[]) => {
    const result = attachedLinksSchema.safeParse(links);
    return issues(result);
  };

  it('keeps complete rows in order, trimmed, and drops blank ones', () => {
    expect(
      attachedLinksSchema.parse([
        { label: ' Program ', url: ' https://osubb.ro/p ' },
        { label: '  ', url: '' },
        ok,
      ]),
    ).toEqual([{ label: 'Program', url: 'https://osubb.ro/p' }, ok]);
    expect(attachedLinksSchema.parse([])).toEqual([]);
  });

  it('judges each row with the pair rule, under that row', () => {
    expect(
      listIssues([ok, { label: 'Poze', url: '' }, { label: '', url: 'x' }]),
    ).toEqual([
      '1.url: link_url_required',
      '2.label: link_label_required',
      '2.url: link_url_invalid',
    ]);
  });

  it('takes five links and refuses a sixth', () => {
    expect(MAX_ATTACHED_LINKS).toBe(5);
    expect(listIssues(Array(5).fill(ok))).toEqual([]);
    expect(listIssues(Array(6).fill(ok))).toEqual([': too_many_links']);
  });

  it('sends every server reason about links to the list itself', () => {
    const map = linksFieldForReason('links');
    for (const reason of [
      'link_incomplete',
      'link_label_too_long',
      'link_url_invalid',
      'link_url_too_long',
      'too_many_links',
    ])
      expect(map[reason], reason).toBe('links');
    expectMapComplete(map, ['links'], Object.keys(map));
  });
});

describe('attachedLinksFrom', () => {
  it('reads a stored links array defensively', () => {
    expect(
      attachedLinksFrom([
        { label: ' Program ', url: ' https://osubb.ro/p ' },
        { label: '', url: 'https://osubb.ro' },
        { label: 'Fără adresă' },
        null,
        'text',
        { label: 'Formular', url: 'https://osubb.ro/f' },
      ]),
    ).toEqual([
      { label: 'Program', url: 'https://osubb.ro/p' },
      { label: 'Formular', url: 'https://osubb.ro/f' },
    ]);
    expect(attachedLinksFrom(null)).toEqual([]);
    expect(attachedLinksFrom({ label: 'x', url: 'https://x' })).toEqual([]);
    expect(
      attachedLinksFrom(Array(7).fill({ label: 'a', url: 'https://a' })),
    ).toHaveLength(5);
  });
});

describe('sameAttachedLinks', () => {
  const a = { label: 'A', url: 'https://a' };
  const b = { label: 'B', url: 'https://b' };
  it('compares trimmed rows in order, ignoring blank rows', () => {
    expect(
      sameAttachedLinks(
        [
          { label: ' A ', url: 'https://a ' },
          { label: '', url: '' },
        ],
        [a],
      ),
    ).toBe(true);
    expect(sameAttachedLinks([a, b], [b, a])).toBe(false);
    expect(sameAttachedLinks([a], [a, b])).toBe(false);
    expect(sameAttachedLinks([], [])).toBe(true);
  });
});
