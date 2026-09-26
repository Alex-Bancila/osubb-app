import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { evaluationSchema, fieldForReason } from './evaluation';

const valid = { difficulty: '3', rating: '4', note: 'Bine' };
const check = (patch: Partial<Record<keyof typeof valid, unknown>>) => {
  const result = evaluationSchema.safeParse({ ...valid, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('reads the selects as numbers and trims the note', () => {
  expect(evaluationSchema.parse({ ...valid, note: '  Bine  ' })).toEqual({
    difficulty: 3,
    rating: 4,
    note: 'Bine',
  });
});

it.each([
  ['', ['difficulty: invalid_difficulty']],
  ['0', ['difficulty: invalid_difficulty']],
  ['1', []],
  ['5', []],
  ['6', ['difficulty: invalid_difficulty']],
  ['2.5', ['difficulty: invalid_difficulty']],
])('keeps a Difficulty of %j within 1–5', (difficulty, expected) => {
  expect(check({ difficulty })).toEqual(expected);
});

it.each([
  ['', ['rating: invalid_rating']],
  [0, ['rating: invalid_rating']],
  [1, []],
  [5, []],
  [6, ['rating: invalid_rating']],
])('keeps a Rating of %j within 1–5', (rating, expected) => {
  expect(check({ rating })).toEqual(expected);
});

it('requires a note of at most 1000 characters', () => {
  expect(check({ note: '   ' })).toEqual(['note: evaluation_note_required']);
  expect(check({ note: 'n'.repeat(1000) })).toEqual([]);
  expect(check({ note: 'n'.repeat(1001) })).toEqual(['note: note_too_long']);
});

it('maps every reason an evaluating command raises to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['difficulty', 'rating', 'note'],
    [
      'invalid_difficulty',
      'invalid_rating',
      'evaluation_note_required',
      'note_too_long',
    ],
  );
});
