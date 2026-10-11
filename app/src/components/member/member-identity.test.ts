import { describe, expect, it } from 'vitest';
import {
  memberDisplayName,
  memberRoleLabel,
  memberSinceLabel,
} from './member-identity';

describe('memberDisplayName', () => {
  it('prefers the Nickname and falls back to the full name (R5)', () => {
    expect(memberDisplayName(' Ani ', 'Ana Pop')).toBe('Ani');
    expect(memberDisplayName('  ', 'Ana Pop')).toBe('Ana Pop');
    expect(memberDisplayName(null, 'Ana Pop')).toBe('Ana Pop');
  });
});

describe('memberRoleLabel (#963)', () => {
  it('names a BC or BCE member by their Board Title', () => {
    expect(memberRoleLabel('BC', 'Președinte')).toBe('Președinte');
    expect(memberRoleLabel('BCE', '  Coordonator IT  ')).toBe('Coordonator IT');
  });

  it('keeps the Role name when there is no title', () => {
    expect(memberRoleLabel('BC', null)).toBe('BC');
    expect(memberRoleLabel('Voluntar', undefined)).toBe('Voluntar');
    expect(memberRoleLabel('BCE', '   ')).toBe('BCE');
  });

  it('says a dash when neither is known', () => {
    expect(memberRoleLabel(null, null)).toBe('—');
    expect(memberRoleLabel(undefined, '')).toBe('—');
    expect(memberRoleLabel('  ', undefined)).toBe('—');
  });
});

describe('memberSinceLabel', () => {
  it('says the join date short, with its year', () => {
    expect(memberSinceLabel('2024-03-12')).toBe('Membru din 12 mar. 2024');
  });

  it('says nothing for a date never recorded or malformed', () => {
    expect(memberSinceLabel(null)).toBeNull();
    expect(memberSinceLabel('2024-13-40')).toBeNull();
  });
});
