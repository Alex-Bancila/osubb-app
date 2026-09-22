import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await import('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

import {
  completedWorkMutationOptions,
  fetchMyCompletedWorkRequests,
  fetchRequestOrigins,
  submitCompletedWork,
} from './completed-work-requests';
import { keys } from './keys';
import type { MyGroup } from './my-groups';

describe('completed-work Request mutation', () => {
  beforeEach(resetSupabaseMock);

  it('sends exactly the description and the chosen Group (#579)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { id: 9 }, error: null });
    await submitCompletedWork({
      description: 'Activitate finalizată',
      origin: { id: 21, name: 'Echipa Media', path: [4, 21] },
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'create_completed_work_request',
      {
        p_description: 'Activitate finalizată',
        p_group_id: 21,
      },
    );
  });

  it('invalidates Cererile mele after success', async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue();
    await completedWorkMutationOptions(client, 'member-1').onSuccess();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.requests.mine('member-1'),
    });
  });

  it('always filters Cererile mele to the signed-in requester', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    supabaseMock.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ eq }),
    });
    await fetchMyCompletedWorkRequests('member-1');
    expect(eq).toHaveBeenCalledWith('requester_id', 'member-1');
  });
});
function myGroup(overrides: Partial<MyGroup>): MyGroup {
  return {
    id: 1,
    name: 'Grup',
    short: 'GRP',
    category: 'department',
    color: '#123456',
    path: [1],
    min_level: 0,
    status: 'active',
    is_organization: false,
    group_role: 'member',
    explicit: true,
    automatic: false,
    ...overrides,
  };
}

it('offers exactly the active my_groups() rows the Member is a member of', async () => {
  resetSupabaseMock();
  supabaseMock.rpc.mockResolvedValue({
    data: [
      myGroup({ id: 4, name: 'Educațional', path: [4] }),
      myGroup({ id: 21, name: 'Echipa Media', path: [4, 21] }),
      // Automatic Membership of the Group itself counts as membership.
      myGroup({
        id: 6,
        name: 'Adunarea Generală',
        path: [6],
        explicit: false,
        automatic: true,
      }),
      // Reached only through a managed ancestor: authority, not membership.
      myGroup({
        id: 22,
        name: 'Echipa Evenimente',
        path: [4, 22],
        group_role: 'manager',
        explicit: false,
      }),
      myGroup({ id: 30, name: 'Arhivă', path: [30], status: 'archived' }),
    ],
    error: null,
  });

  const origins = await fetchRequestOrigins();
  expect(supabaseMock.rpc).toHaveBeenCalledWith('my_groups');
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(origins).toEqual([
    { id: 6, name: 'Adunarea Generală', path: [6] },
    { id: 21, name: 'Echipa Media', path: [4, 21] },
    { id: 4, name: 'Educațional', path: [4] },
  ]);
});

it('surfaces a my_groups() error instead of an empty picker', async () => {
  resetSupabaseMock();
  supabaseMock.rpc.mockResolvedValue({
    data: null,
    error: { message: 'boom' },
  });
  await expect(fetchRequestOrigins()).rejects.toEqual({ message: 'boom' });
});
