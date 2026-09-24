import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { emailSchema, fieldForReason, profileSchema } from './profile';

const valid = { nickname: '', phone: '', avatarColor: '#ED2025' };
const check = (patch: object) => {
  const result = profileSchema.safeParse({ ...valid, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

it('stores the phone in E.164 and a blank one as none', () => {
  for (const phone of ['+40 0730655145', '0730655145', '+40730655145'])
    expect(profileSchema.parse({ ...valid, phone }).phone).toBe('+40730655145');
  expect(profileSchema.parse({ ...valid, phone: '+373 069123456' }).phone).toBe(
    '+37369123456',
  );
  expect(profileSchema.parse({ ...valid, phone: '   ' }).phone).toBeNull();
  expect(profileSchema.parse({ ...valid, phone: null }).phone).toBeNull();
});

it('refuses a phone the server would refuse', () => {
  expect(check({ phone: '+40 123456789' })).toEqual(['phone: phone_invalid']);
  expect(check({ phone: '0730 abc 145' })).toEqual(['phone: phone_invalid']);
});

it('lowercases and trims an email before checking it', () => {
  expect(emailSchema.parse('  Ana.Pop@OSUBB.ro ')).toBe('ana.pop@osubb.ro');
  expect(check({ email: 'not an address' })).toEqual(['email: email_invalid']);
});

it('never carries a full name: BC and the Moderator change it (#675, R5)', () => {
  const parsed = profileSchema.parse({ ...valid, fullName: 'Ana Pop' });
  expect(parsed).not.toHaveProperty('fullName');
  expect(check({ avatarColor: 'red' })).toEqual([
    'avatarColor: invalid_avatar_color',
  ]);
});

/*
 * The Nickname mirrors #675's `profiles_nickname_ck` and its guard: trimmed
 * (and NFC-normalised) before it is measured, 2-24 characters of letters,
 * digits, spaces, `.`, `-`, `_`, blank meaning none.
 */
const nickname = (value: string | null) =>
  profileSchema.parse({ ...valid, nickname: value }).nickname;

it('trims a Nickname and never refuses it for edge whitespace', () => {
  expect(nickname('  Ani  ')).toBe('Ani');
  expect(nickname('\tȘtefan_M.\n')).toBe('Ștefan_M.');
  expect(check({ nickname: '  Ani  ' })).toEqual([]);
});

it('clears the Nickname when it is emptied', () => {
  expect(nickname('')).toBeNull();
  expect(nickname('    ')).toBeNull();
  expect(nickname(null)).toBeNull();
});

it('accepts 2 and 24 characters, diacritics and every allowed sign', () => {
  expect(nickname('Io')).toBe('Io');
  expect(nickname('a'.repeat(24))).toBe('a'.repeat(24));
  expect(nickname('Ăla-Bala 2.0_x')).toBe('Ăla-Bala 2.0_x');
  // A decomposed ș is stored composed, and counts once.
  expect(nickname('șt')).toBe('șt');
});

it('refuses a Nickname outside 2-24 characters, measured after trimming', () => {
  expect(check({ nickname: 'A' })).toEqual(['nickname: nickname_too_short']);
  expect(check({ nickname: '  A  ' })).toEqual([
    'nickname: nickname_too_short',
  ]);
  expect(check({ nickname: 'a'.repeat(25) })).toEqual([
    'nickname: nickname_too_long',
  ]);
});

it('refuses a Nickname with a character the server refuses', () => {
  for (const value of ['Ana!', 'Ani@osubb', 'a/b', 'emoji 🙂', 'tab\tin'])
    expect(check({ nickname: value }), value).toEqual([
      'nickname: nickname_invalid',
    ]);
});

it('maps every profile reason to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['nickname', 'phone', 'avatarColor', 'email'],
    [
      'phone_invalid',
      'nickname_too_short',
      'nickname_too_long',
      'nickname_invalid',
      'nickname_taken',
    ],
  );
  expect(fieldForReason.nickname_taken).toBe('nickname');
});
