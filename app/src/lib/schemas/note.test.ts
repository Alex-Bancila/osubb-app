import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { fieldForReason, noteSchema, optionalNoteSchema } from './note';

const check = (note: string) => {
  const result = noteSchema.safeParse({ note });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it.each([
  ['  ', ['note: note_required']],
  ['n', []],
  ['n'.repeat(1000), []],
  [`  ${'n'.repeat(1000)}  `, []],
  ['n'.repeat(1001), ['note: note_too_long']],
])('measures the note %j trimmed, at the boundary', (note, expected) => {
  expect(check(note)).toEqual(expected);
});

it('sends the trimmed note', () => {
  expect(noteSchema.parse({ note: '  Surse  ' })).toEqual({ note: 'Surse' });
});

it('maps both note reasons to the note', () => {
  expectMapComplete(
    fieldForReason,
    ['note'],
    ['note_required', 'note_too_long'],
  );
});

it.each([
  ['  ', null, []],
  ['n'.repeat(1000), 'n'.repeat(1000), []],
  ['n'.repeat(1001), undefined, ['note: note_too_long']],
])(
  'an optional note %j: blank is no note, the limit still holds',
  (note, parsed, expected) => {
    const result = optionalNoteSchema.safeParse({ note });
    expectRoutable(result, fieldForReason);
    expect(issues(result)).toEqual(expected);
    if (parsed !== undefined) expect(result.data).toEqual({ note: parsed });
  },
);
