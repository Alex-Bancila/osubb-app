import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byMode: vi.fn(),
  queueOpened: vi.fn(),
  queueOpen: vi.fn(),
  myTasksSelect: vi.fn(),
  byMember: vi.fn(),
  orderAssignedAt: vi.fn(),
  orderId: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));

import { fetchMyTasks, fetchOpenTasks } from './tasks';

describe('public Task opportunities', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byMode });
    api.byMode.mockReturnValue({ not: api.queueOpened });
    api.queueOpened.mockReturnValue({ is: api.queueOpen });
  });

  /* #345 retired the legacy multi-assignee join table, so "unclaimed" is no
     longer a fact this query can read: an Assignment embed would show only
     the caller's own rows. An open Candidate Queue is the Task's own record
     of being available, and it is what the tasks_read policy's R6 branch
     already uses. */
  it('asks for every RLS-visible public Task whose Queue is open', async () => {
    api.queueOpen.mockResolvedValue({
      data: [
        {
          id: 2,
          title: 'Local work already in progress',
          status: 'in_progress',
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
        title: 'Local work already in progress',
        status: 'in_progress',
        deadline: null,
      },
    ]);
    expect(api.from).toHaveBeenCalledWith('tasks');
    expect(api.byMode).toHaveBeenCalledWith('assignment_mode', 'public');
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

describe('my tasks', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.myTasksSelect });
    api.myTasksSelect.mockReturnValue({ eq: api.byMember });
    api.byMember.mockReturnValue({ order: api.orderAssignedAt });
    api.orderAssignedAt.mockReturnValue({ order: api.orderId });
  });

  /* This is the residual from #345's review (Finding 4): the old query
     filtered `ended_at is null`, which silently dropped every completed,
     unfulfilled and cancelled Task from "Taskurile mele". Points come from
     completed work, so a member's own list must keep terminal Tasks — this
     test fails the moment that filter comes back. */
  it('keeps completed, unfulfilled and cancelled Tasks in the list', async () => {
    api.orderId.mockResolvedValue({
      data: [
        {
          task: {
            id: 1,
            title: 'Finished work',
            status: 'completed',
            deadline: null,
          },
        },
        {
          task: {
            id: 2,
            title: 'Failed work',
            status: 'unfulfilled',
            deadline: null,
          },
        },
        {
          task: {
            id: 3,
            title: 'Cancelled work',
            status: 'cancelled',
            deadline: null,
          },
        },
      ],
      error: null,
    });

    const result = await fetchMyTasks('member-1');

    expect(result.map((task) => task.status).sort()).toEqual([
      'cancelled',
      'completed',
      'unfulfilled',
    ]);
    expect(api.from).toHaveBeenCalledWith('task_assignments');
    expect(api.byMember).toHaveBeenCalledWith('member_id', 'member-1');
    expect(api.orderAssignedAt).toHaveBeenCalledWith('assigned_at', {
      ascending: false,
    });
    expect(api.orderId).toHaveBeenCalledWith('id', { ascending: false });
  });

  /* A reopened Task has two Assignment rows for the same member (Task
     History is append-only). Without a structural dedupe this would render
     the Task twice and collide on `key={task.id}` — asserted here by picking
     the most recent Assignment (the row PostgREST returns first once ordered
     `assigned_at, id` descending) to represent the Task. */
  it('collapses a reopened Task’s two Assignments into a single row', async () => {
    api.orderId.mockResolvedValue({
      data: [
        {
          task: {
            id: 5,
            title: 'Reopened task',
            status: 'in_progress',
            deadline: null,
          },
        },
        {
          task: {
            id: 5,
            title: 'Reopened task',
            status: 'in_progress',
            deadline: null,
          },
        },
      ],
      error: null,
    });

    const result = await fetchMyTasks('member-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(5);
  });

  it('drops rows whose embedded Task did not come back (e.g. hidden by RLS)', async () => {
    api.orderId.mockResolvedValue({
      data: [{ task: null }],
      error: null,
    });

    await expect(fetchMyTasks('member-1')).resolves.toEqual([]);
  });

  it('surfaces read failures', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.orderId.mockResolvedValue({ data: null, error });
    await expect(fetchMyTasks('member-1')).rejects.toBe(error);
  });
});
