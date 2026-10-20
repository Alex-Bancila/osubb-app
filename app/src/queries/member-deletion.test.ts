import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { keys } from './keys';
import {
  memberDeletable,
  readMemberDeletePreview,
  useDeleteMember,
} from './member-deletion';

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

it('marks every family that named the account stale, Privacy Acknowledgements included', async () => {
  rpc.mockResolvedValue({ data: { member_id: 'm' }, error: null });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useDeleteMember(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await act(() => result.current.mutateAsync('m'));
  expect(rpc).toHaveBeenCalledWith('delete_member', { p_member_id: 'm' });
  const families = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  expect(families).toEqual(
    expect.arrayContaining([
      keys.members.all,
      keys.groups.all,
      keys.notifications.all,
      keys.privacy.all,
    ]),
  );
});
