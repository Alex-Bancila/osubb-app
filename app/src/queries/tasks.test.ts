import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byMode: vi.fn(),
  queueOpened: vi.fn(),
  queueOpen: vi.fn(),
  byMember: vi.fn(),
  orderAssignedAt: vi.fn(),
  orderId: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from, rpc: api.rpc },
}));

import { fetchMyTasks, fetchOpenTasks } from './tasks';
import { taskRow } from '../test/task-fixtures';

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

describe('normalized My tasks reads', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byMember });
    api.byMember.mockReturnValue({ order: api.orderAssignedAt });
    api.orderAssignedAt.mockReturnValue({ order: api.orderId });
    api.rpc.mockResolvedValue({ data: [], error: null });
  });

  it('reads current and past own Assignments, deduplicates Tasks, and sorts exact instants', async () => {
    const later = taskRow({ id: 2, deadline: '2026-09-16T08:00:00Z' });
    const earlier = taskRow({ id: 1, deadline: '2026-09-16T10:00:00+03:00' });
    api.orderId.mockResolvedValue({
      data: [
        { task: later },
        { task: earlier },
        { task: later },
        { task: null },
      ],
      error: null,
    });
    api.rpc.mockResolvedValue({
      data: [
        { task_id: 1, member_id: 'member', full_name: 'Executor Vizibil' },
      ],
      error: null,
    });

    await expect(fetchMyTasks('member')).resolves.toMatchObject([
      {
        id: 1,
        visibleExecutor: {
          memberId: 'member',
          fullName: 'Executor Vizibil',
        },
      },
      { id: 2, visibleExecutor: null },
    ]);
    expect(api.from).toHaveBeenCalledWith('task_assignments');
    expect(api.byMember).toHaveBeenCalledWith('member_id', 'member');
    expect(api.select.mock.lastCall?.[0]).toContain(
      'evaluations:task_evaluations',
    );
    expect(api.select.mock.lastCall?.[0]).not.toContain('task_assignees');
    expect(api.rpc).toHaveBeenCalledWith('visible_task_executors', {
      p_task_ids: [1, 2],
    });
  });

  /* #345's review, Finding 4: the query once filtered `ended_at is null`,
     which silently dropped every completed, unfulfilled and cancelled Task
     from "Taskurile mele". Points come from completed work, so a member's own
     list must keep terminal Tasks — this fails the moment that filter comes
     back. */
  it('keeps completed, unfulfilled and cancelled Tasks in the list', async () => {
    api.orderId.mockResolvedValue({
      data: [
        { task: taskRow({ id: 1, status: 'completed', deadline: null }) },
        { task: taskRow({ id: 2, status: 'unfulfilled', deadline: null }) },
        { task: taskRow({ id: 3, status: 'cancelled', deadline: null }) },
      ],
      error: null,
    });

    const result = await fetchMyTasks('member');

    expect(result.map((task) => task.status).sort()).toEqual([
      'cancelled',
      'completed',
      'unfulfilled',
    ]);
  });

  /* A reopened Task has two Assignment rows for the same member (Task History
     is append-only). The dedupe is structural, and *which* Assignment wins is
     deterministic: newest-first ordering means the first row seen for a Task
     id is its most recent Assignment. */
  it('collapses a reopened Task’s Assignments into one row, newest first', async () => {
    api.orderId.mockResolvedValue({
      data: [
        { task: taskRow({ id: 5, status: 'in_progress', deadline: null }) },
        { task: taskRow({ id: 5, status: 'completed', deadline: null }) },
      ],
      error: null,
    });

    const result = await fetchMyTasks('member');

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(5);
    expect(result[0]?.status).toBe('in_progress');
    expect(api.orderAssignedAt).toHaveBeenCalledWith('assigned_at', {
      ascending: false,
    });
    expect(api.orderId).toHaveBeenCalledWith('id', { ascending: false });
  });

  it('batches parent titles and retains a fallback for RLS-hidden parents', async () => {
    const child = taskRow({ parent_task_id: 10 });
    const hiddenChild = taskRow({ id: 2, parent_task_id: 11 });
    const parents = vi.fn().mockResolvedValue({
      data: [{ id: 10, title: 'Recrutare' }],
      error: null,
    });
    api.select
      .mockReturnValueOnce({ eq: api.byMember })
      .mockReturnValueOnce({ in: parents });
    api.orderId.mockResolvedValue({
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

  it('drops rows whose embedded Task did not come back (e.g. hidden by RLS)', async () => {
    api.orderId.mockResolvedValue({ data: [{ task: null }], error: null });
    await expect(fetchMyTasks('member')).resolves.toEqual([]);
  });

  it('surfaces failures without returning a misleading empty list', async () => {
    const error = { code: '42501', message: 'denied' };
    api.orderId.mockResolvedValue({ data: null, error });
    await expect(fetchMyTasks('member')).rejects.toBe(error);
  });
});
