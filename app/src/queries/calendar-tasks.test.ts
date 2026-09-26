import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

import { fetchPendingCandidatureTasks } from './calendar-tasks';

const row = {
  id: 7,
  title: 'Voluntar la stand',
  status: 'todo',
  deadline: '2026-10-20T09:00:00.000Z',
  group_id: 12,
  campaign_id: null,
  group: null,
};

describe('pending candidature Tasks', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  // The read the Tracker's Disponibile tab makes is unfiltered; the Calendar
  // wants only a candidature still waiting. Mutation this catches: dropping
  // the `status = 'pending'` filter, or the self-filter a manager needs.
  it('reads my own pending candidatures, each Task once', async () => {
    supabaseMock.eq.mockReturnValueOnce(supabaseMock).mockResolvedValueOnce({
      data: [{ task: row }, { task: row }, { task: null }],
      error: null,
    });

    const tasks = await fetchPendingCandidatureTasks('member-1');

    expect(supabaseMock.from).toHaveBeenCalledWith('task_candidates');
    expect(supabaseMock.select).toHaveBeenCalledWith(
      expect.stringContaining('task:tasks!task_candidates_task_id_fkey('),
    );
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'member_id', 'member-1');
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'status', 'pending');
    expect(tasks).toEqual([row]);
  });

  it('surfaces the Supabase error to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabaseMock.eq
      .mockReturnValueOnce(supabaseMock)
      .mockResolvedValueOnce({ data: null, error });

    await expect(fetchPendingCandidatureTasks('member-1')).rejects.toBe(error);
  });
});
