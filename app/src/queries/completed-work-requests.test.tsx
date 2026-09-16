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

  it('sends exactly one actor-independent Origin to the RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { id: 9 }, error: null });
    await submitCompletedWork({
      description: 'Activitate finalizată',
      origin: { key: 'team:media', type: 'team', id: 'media', name: 'Media' },
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'create_completed_work_request',
      {
        p_description: 'Activitate finalizată',
        p_dept_id: null,
        p_team_id: 'media',
        p_project_id: null,
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
it('uses live self memberships and excludes stale and archived Origins', async () => {
  resetSupabaseMock();
  const departmentMembershipEq = vi.fn().mockResolvedValue({
    data: [{ dept_id: 'edu' }],
    error: null,
  });
  const teamMembershipEq = vi.fn().mockResolvedValue({
    data: [{ team_id: 'media' }],
    error: null,
  });
  supabaseMock.from
    .mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        data: [
          { id: 'edu', name: 'Educațional' },
          { id: 'fin', name: 'Financiar' },
        ],
        error: null,
      }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        data: [
          { id: 'media', name: 'Media' },
          { id: 'events', name: 'Evenimente' },
        ],
        error: null,
      }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ eq: departmentMembershipEq }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValue({ eq: teamMembershipEq }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              project_id: 7,
              projects: { id: 7, name: 'OSUBB Fest', status: 'active' },
            },
            {
              project_id: 8,
              projects: { id: 8, name: 'Arhivă', status: 'archived' },
            },
          ],
          error: null,
        }),
      }),
    });

  const origins = await fetchRequestOrigins('member-1');
  expect(departmentMembershipEq).toHaveBeenCalledWith('member_id', 'member-1');
  expect(teamMembershipEq).toHaveBeenCalledWith('member_id', 'member-1');
  expect(origins.map((origin) => origin.key).sort()).toEqual([
    'department:edu',
    'project:7',
    'team:media',
  ]);
});
