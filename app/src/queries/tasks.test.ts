import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byStatus: vi.fn(),
  byMode: vi.fn(),
  byAudience: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));

import { fetchOpenTasks } from './tasks';

describe('public Task opportunities', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byStatus });
    api.byStatus.mockReturnValue({ eq: api.byMode });
    api.byMode.mockReturnValue({ eq: api.byAudience });
  });

  it('returns only unassigned organization-wide public todo Tasks', async () => {
    api.byAudience.mockResolvedValue({
      data: [
        {
          id: 2,
          title: 'Assigned opportunity',
          status: 'todo',
          deadline: null,
          task_assignees: [{ member_id: 'member-1' }],
        },
        {
          id: 1,
          title: 'Available opportunity',
          status: 'todo',
          deadline: '2026-09-12T10:00:00Z',
          task_assignees: [],
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
    ]);
    expect(api.from).toHaveBeenCalledWith('tasks');
    expect(api.byStatus).toHaveBeenCalledWith('status', 'todo');
    expect(api.byMode).toHaveBeenCalledWith('assignment_mode', 'public');
    expect(api.byAudience).toHaveBeenCalledWith('audience', 'org');
  });

  /* #317 moved a Task's points onto its Evaluation and dropped tasks.points,
     so asking for the column would make every tracker request fail with a
     PostgREST 42703 rather than merely render a stale number. */
  it('asks for difficulty and rating, never a points column tasks no longer has', async () => {
    api.byAudience.mockResolvedValue({ data: [], error: null });
    await fetchOpenTasks();

    const selected = api.select.mock.calls[0]?.[0] as string;
    expect(selected).toContain('difficulty');
    expect(selected).toContain('rating');
    expect(selected).not.toContain('points');
  });

  it('surfaces read failures', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.byAudience.mockResolvedValue({ data: null, error });
    await expect(fetchOpenTasks()).rejects.toBe(error);
  });
});
