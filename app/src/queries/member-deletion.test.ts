import { expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { memberDeletable, readMemberDeletePreview } from './member-deletion';

/* #1087 (ruling R59): `member_delete_preview` as the page reads it. */
it('reads the preview: what holds the account, what goes with it, the last holder', () => {
  expect(
    readMemberDeletePreview({
      holds: { 'tasks.created_by': 2, 'points_ledger.member_id': '5' },
      goes: { group_members: 1, notifications: 3 },
      last_holder: null,
    }),
  ).toEqual({
    holds: { 'tasks.created_by': 2, 'points_ledger.member_id': 5 },
    goes: { group_members: 1, notifications: 3 },
    lastHolder: null,
  });
  expect(
    readMemberDeletePreview({ holds: {}, goes: {}, last_holder: 'moderator' })
      .lastHolder,
  ).toBe('moderator');
});

it('drops what is not a positive count and any last holder it does not know', () => {
  expect(
    readMemberDeletePreview({
      holds: { 'tasks.created_by': 0, 'events.created_by': 'x' },
      goes: [],
      last_holder: 'voluntar',
    }),
  ).toEqual({ holds: {}, goes: {}, lastHolder: null });
});

it('is deletable only with nothing holding it and someone else holding its rank', () => {
  const free = readMemberDeletePreview({
    holds: {},
    goes: {},
    last_holder: null,
  });
  expect(memberDeletable(free)).toBe(true);
  expect(memberDeletable({ ...free, holds: { 'tasks.created_by': 1 } })).toBe(
    false,
  );
  expect(memberDeletable({ ...free, lastHolder: 'bc' })).toBe(false);
});
