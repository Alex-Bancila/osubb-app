import { describe, expect, it } from 'vitest';
import { isUuid, parsePositiveInt } from './ids';

describe('parsePositiveInt', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['9007199254740991', 9007199254740991],
  ])('reads %j', (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '2.0',
    '1e3',
    '0x10',
    ' 1',
    '1 ',
    'NaN',
    'Infinity',
    '9007199254740993',
  ])('refuses %j', (raw) => {
    expect(parsePositiveInt(raw)).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a Member id in either case', () => {
    expect(isUuid('7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d')).toBe(true);
    expect(isUuid('7A3C1E2B-4D5F-4A6B-8C9D-0E1F2A3B4C5D')).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'target',
    '7a3c1e2b4d5f4a6b8c9d0e1f2a3b4c5d',
    '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5',
    '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d ',
    'zzzzzzzz-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  ])('refuses %j', (raw) => {
    expect(isUuid(raw)).toBe(false);
  });
});
