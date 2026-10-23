import { describe, expect, it } from 'vitest';
import {
  matchesMemberSearch,
  memberComboboxFilter,
  memberSearchText,
  normalizeSearch,
} from './member-search';

describe('normalizeSearch', () => {
  it('is case- and diacritic-blind', () => {
    expect(normalizeSearch('ȘTEFAN Țară ăâî')).toBe('stefan tara aai');
  });
});

describe('memberSearchText', () => {
  it('holds the Nickname and the full name', () => {
    expect(memberSearchText('Stefi', 'Ștefan Ionescu')).toBe(
      'stefi stefan ionescu',
    );
  });

  it('is the full name alone without a Nickname', () => {
    expect(memberSearchText(null, 'Ana Pop').trim()).toBe('ana pop');
    expect(memberSearchText('  ', 'Ana Pop').trim()).toBe('ana pop');
  });
});

describe('matchesMemberSearch', () => {
  it('finds a Member by part of the real name or of the Nickname', () => {
    expect(matchesMemberSearch('ionescu', 'Stefi', 'Ștefan Ionescu')).toBe(
      true,
    );
    expect(matchesMemberSearch('stefi', 'Stefi', 'Ștefan Ionescu')).toBe(true);
    expect(matchesMemberSearch('stefan', null, 'Ștefan Ionescu')).toBe(true);
  });

  it('ignores surrounding spaces and case', () => {
    expect(matchesMemberSearch('  ȘTEFAN ', 'Stefi', 'Ștefan I.')).toBe(true);
  });

  it('finds nothing for an unknown name and everything for an empty query', () => {
    expect(matchesMemberSearch('maria', 'Stefi', 'Ștefan Ionescu')).toBe(false);
    expect(matchesMemberSearch('  ', 'Stefi', 'Ștefan Ionescu')).toBe(true);
  });

  it('can also search further words, such as a Role', () => {
    expect(
      matchesMemberSearch('presedinte', null, 'Ana Pop', 'Președinte'),
    ).toBe(true);
    expect(matchesMemberSearch('presedinte', null, 'Ana Pop')).toBe(false);
  });
});

describe('memberComboboxFilter', () => {
  const filter = memberComboboxFilter(
    (row: { nick: string | null; full: string }) => ({
      nickname: row.nick,
      fullName: row.full,
    }),
  );

  it('filters an item on both of its names', () => {
    const row = { nick: 'Stefi', full: 'Ștefan Ionescu' };
    expect(filter(row, 'IONESCU')).toBe(true);
    expect(filter(row, 'stefi')).toBe(true);
    expect(filter(row, 'popescu')).toBe(false);
  });
});
