import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { fieldForReason, memberIdentitySchema } from './member-identity';

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
    ],
  );
});
