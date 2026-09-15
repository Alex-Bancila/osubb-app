import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byStatus: vi.fn(),
  byMode: vi.fn(),
  byAudience: vi.fn(),
  queueOpened: vi.fn(),
  queueOpen: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));

import { fetchOpenTasks } from './tasks';

describe('public Task opportunities', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byStatus });
    api.byStatus.mockReturnValue({ eq: api.byMode });
    api.byMode.mockReturnValue({ eq: api.byAudience });
    api.byAudience.mockReturnValue({ not: api.queueOpened });
    api.queueOpened.mockReturnValue({ is: api.queueOpen });
  });

  /* #345 retired the legacy multi-assignee join table, so "unclaimed" is no
     longer a fact this query can read: an Assignment embed would show only
     the caller's own rows. An open Candidate Queue is the Task's own record
     of being available, and it is what the tasks_read policy's R6 branch
     already uses. */
  it('asks the database for organization-wide public todo Tasks whose Queue is open', async () => {
    api.queueOpen.mockResolvedValue({
      data: [
        {
          id: 2,
          title: 'Later opportunity',
          status: 'todo',
          deadline: null,
        },
        {
          id: 1,
          title: 'Available opportunity',
          status: 'todo',
          deadline: '2026-09-12T10:00:00Z',
        },
      ],
      error: null,
    });

    await expect(fetchOpenTasks()).resolves.toEqual([
      {
        id: 1,
        title: 'Available opportunity',
        status: 'todo',
        deadline: '2026-09-12T10:00:00Z',
      },
      {
        id: 2,
        title: 'Later opportunity',
        status: 'todo',
        deadline: null,
      },
    ]);
    expect(api.from).toHaveBeenCalledWith('tasks');
    expect(api.byStatus).toHaveBeenCalledWith('status', 'todo');
    expect(api.byMode).toHaveBeenCalledWith('assignment_mode', 'public');
    expect(api.byAudience).toHaveBeenCalledWith('audience', 'org');
    expect(api.queueOpened).toHaveBeenCalledWith('queue_opened_at', 'is', null);
    expect(api.queueOpen).toHaveBeenCalledWith('queue_closed_at', null);
  });

  /* #317 moved a Task's points onto its Evaluation and dropped tasks.points,
     so asking for the column would make every tracker request fail with a
     PostgREST 42703 rather than merely render a stale number. */
  it('asks for difficulty and rating, never a points column tasks no longer has', async () => {
    api.queueOpen.mockResolvedValue({ data: [], error: null });
    await fetchOpenTasks();

    const selected = api.select.mock.calls[0]?.[0] as string;
    expect(selected).toContain('difficulty');
    expect(selected).toContain('rating');
    expect(selected).not.toContain('points');
  });

  it('surfaces read failures', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.queueOpen.mockResolvedValue({ data: null, error });
    await expect(fetchOpenTasks()).rejects.toBe(error);
  });
});
