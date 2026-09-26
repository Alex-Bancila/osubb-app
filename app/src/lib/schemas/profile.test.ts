import { expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { emailSchema, fieldForReason, profileSchema } from './profile';

const valid = { phone: '', avatarColor: '#ED2025' };
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

it('requires a full name only when one is sent, and a colour from the palette format', () => {
  expect(check({})).toEqual([]);
  expect(check({ fullName: '   ' })).toEqual(['fullName: full_name_required']);
  expect(
    profileSchema.parse({ ...valid, fullName: '  Ana Pop ' }),
  ).toMatchObject({ fullName: 'Ana Pop' });
  expect(check({ avatarColor: 'red' })).toEqual([
    'avatarColor: invalid_avatar_color',
  ]);
});

it('maps every profile reason to its field', () => {
  expectMapComplete(
    fieldForReason,
    ['fullName', 'phone', 'avatarColor', 'email'],
    ['phone_invalid'],
  );
});
