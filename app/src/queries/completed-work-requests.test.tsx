import { answered } from '../test/postgrest-fake';
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
    const order = vi.fn().mockReturnValue(answered({ data: [], error: null }));
    const eq = vi.fn().mockReturnValue({ order });
    supabaseMock.from.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ eq }),
    });
    await fetchMyCompletedWorkRequests('member-1');
    expect(eq).toHaveBeenCalledWith('requester_id', 'member-1');
  });
});
it('offers exactly the Groups the server accepts, a visible non-member Group included (R64, #1099)', async () => {
  resetSupabaseMock();
  // request_origins() is the command's own rule; the Member is in none of
  // these but the Organization Group, and the picker shows them all.
  supabaseMock.rpc.mockResolvedValue({
    data: [
      { id: 4, name: 'Educațional', path: [4] },
      { id: 1, name: 'OSUBB', path: [1] },
      { id: 21, name: 'Echipa Media', path: [4, 21] },
    ],
    error: null,
  });

  const origins = await fetchRequestOrigins();
  expect(supabaseMock.rpc).toHaveBeenCalledWith('request_origins');
  expect(supabaseMock.rpc).not.toHaveBeenCalledWith('my_groups');
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(origins).toEqual([
    { id: 21, name: 'Echipa Media', path: [4, 21] },
    { id: 4, name: 'Educațional', path: [4] },
    { id: 1, name: 'OSUBB', path: [1] },
  ]);
});

it('surfaces a request_origins() error instead of an empty picker', async () => {
  resetSupabaseMock();
  supabaseMock.rpc.mockResolvedValue({
    data: null,
    error: { message: 'boom' },
  });
  await expect(fetchRequestOrigins()).rejects.toEqual({ message: 'boom' });
});
