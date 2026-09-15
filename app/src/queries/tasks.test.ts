import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byStatus: vi.fn(),
  byMode: vi.fn(),
  byAudience: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));

import { fetchMyTasks, fetchOpenTasks } from './tasks';
import { taskRow } from '../test/task-fixtures';

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

describe('normalized My tasks reads', () => {
  it('reads current and past own Assignments, deduplicates Tasks, and sorts exact instants', async () => {
    const later = taskRow({ id: 2, deadline: '2026-09-16T08:00:00Z' });
    const earlier = taskRow({ id: 1, deadline: '2026-09-16T10:00:00+03:00' });
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byStatus });
    api.byStatus.mockResolvedValue({
      data: [
        { task: later },
        { task: earlier },
        { task: later },
        { task: null },
      ],
      error: null,
    });

    await expect(fetchMyTasks('member')).resolves.toEqual([earlier, later]);
    expect(api.from).toHaveBeenCalledWith('task_assignments');
    expect(api.byStatus).toHaveBeenCalledWith('member_id', 'member');
    expect(api.select.mock.lastCall?.[0]).toContain(
      'evaluations:task_evaluations',
    );
    expect(api.select.mock.lastCall?.[0]).not.toContain('task_assignees');
  });

  it('batches parent titles and retains a fallback for RLS-hidden parents', async () => {
    const child = taskRow({ parent_task_id: 10 });
    const hiddenChild = taskRow({ id: 2, parent_task_id: 11 });
    const parents = vi.fn().mockResolvedValue({
      data: [{ id: 10, title: 'Recrutare' }],
      error: null,
    });
    api.from.mockReturnValue({ select: api.select });
    api.select
      .mockReturnValueOnce({ eq: api.byStatus })
      .mockReturnValueOnce({ in: parents });
    api.byStatus.mockResolvedValue({
      data: [{ task: child }, { task: hiddenChild }],
      error: null,
    });
    const tasks = await fetchMyTasks('member');
    expect(parents).toHaveBeenCalledWith('id', [10, 11]);
    expect(tasks.find((task) => task.id === 1)?.parent).toEqual({
      id: 10,
      title: 'Recrutare',
    });
    expect(tasks.find((task) => task.id === 2)?.parent).toBeNull();
  });

  it('surfaces failures without returning a misleading empty list', async () => {
    const error = { code: '42501', message: 'denied' };
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byStatus });
    api.byStatus.mockResolvedValue({ data: null, error });
    await expect(fetchMyTasks('member')).rejects.toBe(error);
  });
});
