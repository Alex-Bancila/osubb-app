import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }));

import { taskRow } from '../test/task-fixtures';
import { attachVisibleTaskExecutors } from './task-executors';

describe('visible Task Executors', () => {
  beforeEach(() => api.rpc.mockReset());

  it('loads one safe Executor batch and marks Tasks without one explicitly', async () => {
    api.rpc.mockResolvedValue({
      data: [
        {
          task_id: 1,
          member_id: 'executor-1',
          full_name: 'Ana Executor',
        },
      ],
      error: null,
    });
    const first = taskRow({ id: 1 });
    const second = taskRow({ id: 2, assignments: [] });

    await expect(
      attachVisibleTaskExecutors([first, second]),
    ).resolves.toMatchObject([
      {
        id: 1,
        visibleExecutor: {
          memberId: 'executor-1',
          fullName: 'Ana Executor',
        },
      },
      { id: 2, visibleExecutor: null },
    ]);
    expect(api.rpc).toHaveBeenCalledOnce();
    expect(api.rpc).toHaveBeenCalledWith('visible_task_executors', {
      p_task_ids: [1, 2],
    });
  });

  it('deduplicates Task ids before requesting the batch', async () => {
    api.rpc.mockResolvedValue({ data: [], error: null });

    await attachVisibleTaskExecutors([
      taskRow({ id: 2 }),
      taskRow({ id: 1 }),
      taskRow({ id: 2 }),
    ]);

    expect(api.rpc).toHaveBeenCalledWith('visible_task_executors', {
      p_task_ids: [2, 1],
    });
  });

  it('does not call the backend for an empty Task set', async () => {
    await expect(attachVisibleTaskExecutors([])).resolves.toEqual([]);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('surfaces backend failures instead of showing false unassigned states', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.rpc.mockResolvedValue({ data: null, error });

    await expect(attachVisibleTaskExecutors([taskRow()])).rejects.toBe(error);
  });
});
