import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }));

import { taskRow } from '../test/task-fixtures';
import { attachVisibleTaskExecutors } from './task-executors';

describe('visible Task Executors', () => {
  // A block body: an arrow returning the mock would make Vitest call it as a
  // teardown hook after every test.
  beforeEach(() => {
    api.rpc.mockReset();
  });

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

  it('splits more than 200 Task ids into batches the RPC accepts', async () => {
    api.rpc.mockImplementation(
      async (_name: string, { p_task_ids }: { p_task_ids: number[] }) => {
        return {
          data: p_task_ids.includes(450)
            ? [{ task_id: 450, member_id: 'executor-450', full_name: 'Ana' }]
            : [],
          error: null,
        };
      },
    );
    const rows = Array.from({ length: 450 }, (_, index) =>
      taskRow({ id: index + 1 }),
    );

    const enriched = await attachVisibleTaskExecutors(rows);

    expect(api.rpc).toHaveBeenCalledTimes(3);
    expect(
      api.rpc.mock.calls.map(([, args]) => args.p_task_ids.length),
    ).toEqual([200, 200, 50]);
    expect(enriched.at(-1)?.visibleExecutor).toMatchObject({
      memberId: 'executor-450',
    });
  });

  it('maps is_current: the Executor who finished a Task is not current (#861)', async () => {
    api.rpc.mockResolvedValue({
      data: [
        {
          task_id: 1,
          member_id: 'executor-1',
          full_name: 'Ana Executor',
          nickname: null,
          is_current: true,
        },
        {
          task_id: 2,
          member_id: 'finisher-2',
          full_name: 'Ioana Finalizare',
          nickname: 'Ioana',
          is_current: false,
        },
      ],
      error: null,
    });

    const [open, finished] = await attachVisibleTaskExecutors([
      taskRow({ id: 1 }),
      taskRow({ id: 2, status: 'completed', assignments: [] }),
    ]);

    expect(open?.visibleExecutor).toEqual({
      memberId: 'executor-1',
      fullName: 'Ana Executor',
      nickname: null,
      isCurrent: true,
    });
    expect(finished?.visibleExecutor).toEqual({
      memberId: 'finisher-2',
      fullName: 'Ioana Finalizare',
      nickname: 'Ioana',
      isCurrent: false,
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
