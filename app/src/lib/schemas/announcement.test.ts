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
  links: [] as { label: string; url: string }[],
  deadline: null as string | null,
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
      links: [
        { label: `  ${'l'.repeat(60)}  `, url: '  https://osubb.ro/f  ' },
        { label: '', url: ' ' },
      ],
    }),
  ).toEqual({
    title: 'Titlu',
    body: 'b'.repeat(2000),
    groupId: 3,
    links: [{ label: 'l'.repeat(60), url: 'https://osubb.ro/f' }],
    deadline: null,
  });
  // #909: a future Termen passes as the ISO instant the form produced.
  expect(
    announcementSchema.parse({ ...valid, deadline: '2099-10-02T20:59:00.000Z' })
      .deadline,
  ).toBe('2099-10-02T20:59:00.000Z');
});

it.each([
  [{ title: ' \t ' }, ['title: title_required']],
  [{ title: '  ab  ' }, ['title: title_too_short']],
  [{ title: 't'.repeat(121) }, ['title: title_too_long']],
  [{ body: '   ' }, ['body: body_required']],
  [{ body: 'b'.repeat(2001) }, ['body: body_too_long']],
  [{ groupId: null as never }, ['groupId: announcement_group_required']],
  [
    { links: [{ label: 'l'.repeat(61), url: 'https://osubb.ro' }] },
    ['links.0.label: link_label_too_long'],
  ],
  [
    {
      links: [
        { label: 'Program', url: 'https://osubb.ro/p' },
        { label: 'Formular', url: 'osubb.ro/formular' },
      ],
    },
    ['links.1.url: link_url_invalid'],
  ],
  // R46: up to five Attached Links.
  [
    { links: Array(6).fill({ label: 'Formular', url: 'https://osubb.ro' }) },
    ['links: too_many_links'],
  ],
  // #909: announcements_guard_deadline's rule, and a wall time Romania skips.
  [{ deadline: '2020-01-01T10:00:00.000Z' }, ['deadline: deadline_in_past']],
  [{ deadline: '' }, ['deadline: deadline_invalid']],
])('refuses %j with the guard’s reason', (patch, expected) => {
  expect(check(patch)).toEqual(expected);
});

it('maps every reason the announcement guard raises to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['title', 'body', 'groupId', 'links', 'deadline'],
    [
      'title_required',
      'title_too_short',
      'title_too_long',
      'body_required',
      'body_too_long',
      'link_label_too_long',
      'link_url_invalid',
      'link_url_too_long',
      'too_many_links',
      'deadline_in_past',
    ],
  );
});
