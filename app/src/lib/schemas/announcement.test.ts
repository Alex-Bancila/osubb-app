import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { announcementSchema, fieldForReason } from './announcement';

const valid = {
  title: 'Titlu',
  body: 'Corp',
  groupId: 3,
  link: { label: '', url: '' },
};
const check = (patch: Partial<typeof valid>) => {
  const result = announcementSchema.safeParse({ ...valid, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('trims every text, as announcements_guard_text does', () => {
  expect(
    announcementSchema.parse({
      ...valid,
      title: '  Titlu  ',
      body: ` ${'b'.repeat(2000)} `,
      link: { label: `  ${'l'.repeat(60)}  `, url: '  https://osubb.ro/f  ' },
    }),
  ).toEqual({
    title: 'Titlu',
    body: 'b'.repeat(2000),
    groupId: 3,
    link: { label: 'l'.repeat(60), url: 'https://osubb.ro/f' },
  });
});

it.each([
  [{ title: ' \t ' }, ['title: title_required']],
  [{ title: '  ab  ' }, ['title: title_too_short']],
  [{ title: 't'.repeat(121) }, ['title: title_too_long']],
  [{ body: '   ' }, ['body: body_required']],
  [{ body: 'b'.repeat(2001) }, ['body: body_too_long']],
  [{ groupId: null as never }, ['groupId: announcement_group_required']],
  [
    { link: { label: 'l'.repeat(61), url: 'https://osubb.ro' } },
    ['link.label: link_label_too_long'],
  ],
  [
    { link: { label: 'Formular', url: 'osubb.ro/formular' } },
    ['link.url: link_url_invalid'],
  ],
])('refuses %j with the guard’s reason', (patch, expected) => {
  expect(check(patch)).toEqual(expected);
});

it('maps every reason the announcement guard raises to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['title', 'body', 'groupId', 'link.label', 'link.url'],
    [
      'title_required',
      'title_too_short',
      'title_too_long',
      'body_required',
      'body_too_long',
      'link_label_too_long',
      'link_url_invalid',
      'link_url_too_long',
    ],
  );
});
