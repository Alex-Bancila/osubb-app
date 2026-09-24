import { describe, expect, it } from 'vitest';
import {
  charLength,
  emptyToNull,
  normalizeEmail,
  normalizePhone,
  trimText,
} from './normalize';

describe('normalizePhone', () => {
  // The exact table of supabase/tests/constraints_kit.test.sql, so the browser
  // and private.normalize_phone (#673) agree case for case.
  it.each([
    ['+40 0730655145', '+40730655145'],
    ['0730655145', '+40730655145'],
    ['+40730655145', '+40730655145'],
    ['730655145', '+40730655145'],
    ['0040 730 655 145', '+40730655145'],
    ['(0730) 655-145', '+40730655145'],
    ['0730.655.145', '+40730655145'],
    ['+373 069123456', '+37369123456'],
    ['+37369123456', '+37369123456'],
    ['0044 20 7946 0958', '+442079460958'],
    ['+1 202 555 0143', '+12025550143'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each<[string | null, string]>([
    ['+40 123456789', 'a Romanian number that does not start with 7'],
    ['+40 73065514', 'a Romanian number one digit short'],
    ['+40 7306551456', 'a Romanian number one digit long'],
    ['+373 6912345', 'a Moldovan number one digit short'],
    ['+1234567', 'seven digits, under E.164'],
    ['+1234567890123456', 'sixteen digits, over E.164'],
    ['+0123456789', 'a country code starting with 0'],
    ['0730 abc 145', 'letters'],
    ['   ', 'blank'],
    [null, 'nothing'],
  ])('refuses %j (%s)', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('text and email', () => {
  it('trims the ends and lowercases an address', () => {
    expect(trimText('  Titlu  ')).toBe('Titlu');
    expect(trimText(null)).toBe('');
    expect(normalizeEmail('  Ana.Pop@OSUBB.ro ')).toBe('ana.pop@osubb.ro');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('turns only an empty value into null', () => {
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull(' ')).toBe(' ');
    expect(emptyToNull('x')).toBe('x');
  });

  it('counts characters as Postgres char_length does, not UTF-16 units', () => {
    expect(charLength('ăîșțâ')).toBe(5);
    expect(charLength('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
  });
});
