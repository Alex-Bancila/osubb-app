import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { fieldForReason, submissionSchema } from './submission';

const check = (note: string, label = '', url = '') => {
  const result = submissionSchema.safeParse({ note, link: { label, url } });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it.each([
  ['', []],
  ['   ', []],
  ['n'.repeat(1000), []],
  [`  ${'n'.repeat(1000)}  `, []],
  ['n'.repeat(1001), ['note: note_too_long']],
])(
  'measures the optional note %j trimmed, at the boundary',
  (note, expected) => {
    expect(check(note)).toEqual(expected);
  },
);

it('takes a link as a pair, under the half that is missing', () => {
  expect(check('', 'Afiș', '')).toEqual(['link.url: link_url_required']);
  expect(check('', '', 'https://x.example')).toEqual([
    'link.label: link_label_required',
  ]);
  expect(check('', 'Afiș', 'ftp://x.example')).toEqual([
    'link.url: link_url_invalid',
  ]);
});

it('sends nulls for an empty draft and trimmed values otherwise', () => {
  expect(
    submissionSchema.parse({ note: '  ', link: { label: '', url: ' ' } }),
  ).toEqual({ note: null, link: { label: null, url: null } });
  expect(
    submissionSchema.parse({
      note: ' Gata ',
      link: { label: ' Afiș ', url: ' https://x.example ' },
    }),
  ).toEqual({
    note: 'Gata',
    link: { label: 'Afiș', url: 'https://x.example' },
  });
});

it('places every reason submit_task_for_review raises', () => {
  expectMapComplete(
    fieldForReason,
    ['note', 'link.label', 'link.url'],
    [
      'note_too_long',
      'link_incomplete',
      'link_label_too_long',
      'link_url_invalid',
      'link_url_too_long',
    ],
  );
});
