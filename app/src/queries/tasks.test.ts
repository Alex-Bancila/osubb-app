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

  it('surfaces read failures', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.byAudience.mockResolvedValue({ data: null, error });
    await expect(fetchOpenTasks()).rejects.toBe(error);
  });
});
