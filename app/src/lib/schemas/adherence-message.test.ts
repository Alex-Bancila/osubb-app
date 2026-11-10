import { expect, it } from 'vitest';
import {
  adherenceMessageFieldForReason,
  adherenceMessageSchema,
} from './adherence-message';

const issues = (value: unknown) => {
  const result = adherenceMessageSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

const link = (label: string, url: string) => ({ label, url });

it('needs a heading and a body, in the server words (R66)', () => {
  expect(issues({ title: '  ', body: ' ', link: link('', '') })).toEqual([
    ['title', 'title_required'],
    ['body', 'body_required'],
  ]);
});

it('keeps the heading to 120 characters and the body to R60 limits', () => {
  expect(
    issues({ title: 'a'.repeat(121), body: 'Text', link: link('', '') }),
  ).toEqual([['title', 'title_too_long']]);
  expect(
    issues({ title: 'Titlu', body: 'a'.repeat(2001), link: link('', '') }),
  ).toEqual([['body', 'body_too_long']]);
  // Markup is not counted as visible characters.
  expect(
    issues({
      title: 'Titlu',
      body: `**${'a'.repeat(1998)}**`,
      link: link('', ''),
    }),
  ).toEqual([]);
});

it('judges the link as an Attached Link: both or neither, http(s), within limits', () => {
  expect(issues({ title: 'T', body: 'B', link: link('Formular', '') })).toEqual(
    [['link.url', 'link_url_required']],
  );
  expect(
    issues({ title: 'T', body: 'B', link: link('', 'https://x.ro') }),
  ).toEqual([['link.label', 'link_label_required']]);
  expect(
    issues({ title: 'T', body: 'B', link: link('Formular', 'ftp://x.ro') }),
  ).toEqual([['link.url', 'link_url_invalid']]);
  expect(
    issues({ title: 'T', body: 'B', link: link('a'.repeat(61), 'https://x') }),
  ).toEqual([['link.label', 'link_label_too_long']]);
});

it('trims what it keeps and stores an empty link as none', () => {
  expect(
    adherenceMessageSchema.parse({
      title: '  Mesaj de la BC ',
      body: '\nFelicitări!\n',
      link: link('  ', ' '),
    }),
  ).toEqual({
    title: 'Mesaj de la BC',
    body: 'Felicitări!',
    link: { label: null, url: null },
  });
  expect(
    adherenceMessageSchema.parse({
      title: 'T',
      body: 'B',
      link: link(' Formularul ', ' https://forms.ro/a '),
    }).link,
  ).toEqual({ label: 'Formularul', url: 'https://forms.ro/a' });
});

it('places every reason the command raises under its field', () => {
  for (const reason of [
    'title_required',
    'title_too_long',
    'body_required',
    'body_too_long',
  ])
    expect(adherenceMessageFieldForReason[reason]).toMatch(/^(title|body)$/);
  for (const reason of [
    'link_incomplete',
    'link_label_too_long',
    'link_url_too_long',
    'link_url_invalid',
  ])
    expect(adherenceMessageFieldForReason[reason]).toMatch(/^link\./);
});
