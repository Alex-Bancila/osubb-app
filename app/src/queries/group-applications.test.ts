import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
/* A table fake for the managed read: every filter it is sent is recorded,
   and `neq` is applied, so the test sees what the server would return. */
const tables = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as unknown[][],
}));
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    let rows = tables.rows[table] ?? [];
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        tables.calls.push([table, 'eq', column, value]);
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        tables.calls.push([table, 'neq', column, value]);
        rows = rows.filter((row) => row[column] !== value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      range: () => Promise.resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { supabase: { rpc, from } };
});
import {
  fetchGroupCoordination,
  fetchManagedGroupApplications,
  runApplicationCommand,
  useApplicationCommand,
} from './group-applications';
beforeEach(() =>
  rpc.mockResolvedValue({ data: { id: 7, status: 'pending' }, error: null }),
);
it('applies with a trimmed optional note and no spoofable actor', async () => {
  await runApplicationCommand({
    kind: 'apply',
    groupId: 3,
    note: '  Vreau să ajut  ',
  });
  expect(rpc).toHaveBeenCalledWith('apply_to_group', {
    p_group_id: 3,
    p_note: 'Vreau să ajut',
  });
});
it('omits a blank note', async () => {
  await runApplicationCommand({ kind: 'apply', groupId: 3, note: '  ' });
  expect(rpc).toHaveBeenCalledWith('apply_to_group', { p_group_id: 3 });
});
it('withdraws the server Application id', async () => {
  await runApplicationCommand({ kind: 'withdraw', applicationId: 7 });
  expect(rpc).toHaveBeenCalledWith('withdraw_group_application', {
    p_application_id: 7,
  });
});
it('marks the pending-Applications reads stale after a command, so a withdrawn one leaves Profil and /grupuri (#699)', async () => {
  const client = new QueryClient();
  const applications = ['groups', 'applications', { memberId: 'm' }];
  client.setQueryData(applications, [{ id: 7 }]);
  const { result } = renderHook(() => useApplicationCommand(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  expect(client.getQueryState(applications)?.isInvalidated).toBe(false);
  await act(() =>
    result.current.mutateAsync({ kind: 'withdraw', applicationId: 7 }),
  );
  expect(client.getQueryState(applications)?.isInvalidated).toBe(true);
});
it.each([true, false])(
  'submits the decision %s and separate decision note',
  async (accept) => {
    await runApplicationCommand({
      kind: 'decide',
      applicationId: 7,
      accept,
      note: '  Mulțumim  ',
    });
    expect(rpc).toHaveBeenCalledWith('decide_group_application', {
      p_application_id: 7,
      p_accept: accept,
      p_note: 'Mulțumim',
    });
  },
);
it.each([
  [
    'group_not_accepting_applications',
    'Acest grup nu primește cereri de înscriere.',
  ],
  ['application_not_pending', 'Cererea a fost deja soluționată.'],
  ['application_withdraw_forbidden', 'Poți retrage doar propria cerere.'],
])('translates %s through the shared table', async (message, copy) => {
  rpc.mockResolvedValue({ data: null, error: { message, code: 'PT409' } });
  await expect(
    runApplicationCommand({ kind: 'withdraw', applicationId: 7 }),
  ).rejects.toThrow(copy);
});

it('reads coordinator identities for MemberName (Nickname and full name)', async () => {
  rpc.mockResolvedValue({
    data: [
      {
        member_id: 'a',
        full_name: 'Full name',
        nickname: 'Nickname',
        group_role: 'manager',
        position_title: null,
      },
      {
        member_id: 'b',
        full_name: 'Second name',
        nickname: null,
        group_role: 'responsible',
        position_title: 'Editor',
      },
    ],
    error: null,
  });
  await expect(fetchGroupCoordination(3)).resolves.toEqual([
    {
      memberId: 'a',
      fullName: 'Full name',
      nickname: 'Nickname',
      groupRole: 'manager',
      positionTitle: null,
    },
    {
      memberId: 'b',
      fullName: 'Second name',
      nickname: null,
      groupRole: 'responsible',
      positionTitle: 'Editor',
    },
  ]);
  expect(rpc).toHaveBeenCalledWith('group_coordination', { p_group_id: 3 });
});
it('reports a failed coordination read rather than displaying an empty list', async () => {
  const error = { message: 'unavailable' };
  rpc.mockResolvedValue({ data: null, error });
  await expect(fetchGroupCoordination(3)).rejects.toEqual(error);
});

it('reads every pending Application the viewer may decide on, minus their own, with applicant and Group names (#825)', async () => {
  tables.calls = [];
  tables.rows = {
    group_applications: [
      {
        id: 1,
        group_id: 2,
        member_id: 'ana',
        status: 'pending',
        note: null,
        created_at: '2026-09-20T10:00:00Z',
      },
      {
        id: 2,
        group_id: 5,
        member_id: 'me',
        status: 'pending',
        note: null,
        created_at: '2026-09-21T10:00:00Z',
      },
      {
        id: 3,
        group_id: 5,
        member_id: 'dan',
        status: 'pending',
        note: 'Salut',
        created_at: '2026-09-22T10:00:00Z',
      },
      {
        id: 4,
        group_id: 2,
        member_id: 'eva',
        status: 'accepted',
        note: null,
        created_at: '2026-09-19T10:00:00Z',
      },
    ],
    profiles_directory: [
      { id: 'ana', full_name: 'Ana Pop', nickname: null, avatar_color: null },
      {
        id: 'dan',
        full_name: 'Dan Ionescu',
        nickname: 'Dănuț',
        avatar_color: '#123456',
      },
    ],
    groups: [
      { id: 2, name: 'Logistică' },
      { id: 5, name: 'Foto' },
    ],
  };
  const rows = await fetchManagedGroupApplications('me');
  expect(rows.map((row) => row.id)).toEqual([1, 3]);
  expect(rows[1]).toMatchObject({
    member: { memberId: 'dan', fullName: 'Dan Ionescu', nickname: 'Dănuț' },
    group: { id: 5, name: 'Foto' },
  });
  // No Group filter: RLS returns exactly the Groups the viewer decides on.
  expect(tables.calls).toEqual([
    ['group_applications', 'eq', 'status', 'pending'],
    ['group_applications', 'neq', 'member_id', 'me'],
  ]);
});

it('keeps the managed queue under the key a decision invalidates (#825)', async () => {
  const client = new QueryClient();
  const managed = ['groups', 'applications', 'managed', { memberId: 'm' }];
  client.setQueryData(managed, []);
  const { result } = renderHook(() => useApplicationCommand(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await act(() =>
    result.current.mutateAsync({
      kind: 'decide',
      applicationId: 7,
      accept: true,
      note: '',
    }),
  );
  expect(client.getQueryState(managed)?.isInvalidated).toBe(true);
});
