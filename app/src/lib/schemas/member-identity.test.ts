import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { OTHER_UNIVERSITY, UBB } from '../universities';
import {
  fieldForReason,
  joinedAtFieldForReason,
  memberIdentitySchema,
  memberJoinedAtSchema,
  memberUniversitySchema,
  universityFieldForReason,
} from './member-identity';

const valid = { nickname: '', fullName: 'Ana Pop' };
const check = (patch: object) => {
  const result = memberIdentitySchema.safeParse({ ...valid, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('trims both names and turns a blank Nickname into none', () => {
  expect(
    memberIdentitySchema.parse({ nickname: '  Ani ', fullName: ' Ana Pop ' }),
  ).toEqual({ nickname: 'Ani', fullName: 'Ana Pop' });
  expect(memberIdentitySchema.parse({ ...valid, nickname: '   ' })).toEqual({
    nickname: null,
    fullName: 'Ana Pop',
  });
});

it('requires a full name', () => {
  expect(check({ fullName: '   ' })).toEqual(['fullName: full_name_required']);
});

it('limits the full name to 120 characters (security pass 2026-09-27)', () => {
  expect(check({ fullName: 'n'.repeat(120) })).toEqual([]);
  expect(check({ fullName: 'n'.repeat(121) })).toEqual([
    'fullName: full_name_too_long',
  ]);
});

it('refuses a Nickname the server refuses, in the server order', () => {
  expect(check({ nickname: 'A' })).toEqual(['nickname: nickname_too_short']);
  expect(check({ nickname: 'a'.repeat(25) })).toEqual([
    'nickname: nickname_too_long',
  ]);
  expect(check({ nickname: 'Ana!' })).toEqual(['nickname: nickname_invalid']);
  expect(check({ nickname: 'Ștefan_M.' })).toEqual([]);
});

it('maps every name reason to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['nickname', 'fullName'],
    [
      'nickname_too_short',
      'nickname_too_long',
      'nickname_invalid',
      'nickname_taken',
      'full_name_too_long',
    ],
  );
});

it('takes a join date that is a real day, not after today in Bucharest (#932)', () => {
  const schema = memberJoinedAtSchema('2026-09-29');
  const judge = (joinedAt: string) => {
    const result = schema.safeParse({ joinedAt });
    expectRoutable(result, joinedAtFieldForReason);
    return issues(result);
  };
  expect(schema.parse({ joinedAt: '2026-09-29' })).toEqual({
    joinedAt: '2026-09-29',
  });
  expect(judge('2019-10-01')).toEqual([]);
  expect(judge('')).toEqual(['joinedAt: joined_at_required']);
  expect(judge('2025-02-30')).toEqual(['joinedAt: joined_at_invalid']);
  expect(judge('2026-09-30')).toEqual(['joinedAt: joined_at_in_future']);
  expectMapComplete(joinedAtFieldForReason, ['joinedAt'], []);
});

it('takes a Universitate from the list, or a typed name of 2-120 characters (R58)', () => {
  const judge = (option: string, other = '') => {
    const result = memberUniversitySchema.safeParse({ option, other });
    expectRoutable(result, universityFieldForReason);
    return issues(result);
  };
  // A list entry goes through unchanged, whatever the free text holds.
  expect(memberUniversitySchema.parse({ option: UBB, other: '' })).toEqual({
    university: UBB,
  });
  expect(memberUniversitySchema.parse({ option: UBB, other: 'a' })).toEqual({
    university: UBB,
  });
  // Altă universitate: the typed name, trimmed before it is measured.
  expect(
    memberUniversitySchema.parse({
      option: OTHER_UNIVERSITY,
      other: '  Universitatea din București  ',
    }),
  ).toEqual({ university: 'Universitatea din București' });
  expect(judge(OTHER_UNIVERSITY, 'Ab')).toEqual([]);
  expect(judge(OTHER_UNIVERSITY, 'A')).toEqual([
    'university: invalid_university',
  ]);
  expect(judge(OTHER_UNIVERSITY, '  A  ')).toEqual([
    'university: invalid_university',
  ]);
  expect(judge(OTHER_UNIVERSITY, '')).toEqual([
    'university: invalid_university',
  ]);
  expect(judge(OTHER_UNIVERSITY, 'a'.repeat(120))).toEqual([]);
  expect(judge(OTHER_UNIVERSITY, 'a'.repeat(121))).toEqual([
    'university: invalid_university',
  ]);
  // Nothing chosen is not a university.
  expect(judge('')).toEqual(['university: invalid_university']);
  expectMapComplete(universityFieldForReason, ['university'], []);
});
