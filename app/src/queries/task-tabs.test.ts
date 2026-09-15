import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: mocks }));
import { fetchManagedTasks } from './task-tabs';
import { taskRow } from '../test/task-fixtures';

beforeEach(() => vi.clearAllMocks());

it('does not query Tasks when the server grants no managed rows', async () => {
  mocks.rpc.mockReturnValue({
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
  });
  await expect(fetchManagedTasks()).resolves.toEqual([]);
  expect(mocks.from).not.toHaveBeenCalled();
});

it('pages authorized IDs and reads only those Tasks through RLS in bounded batches', async () => {
  const ids = Array.from({ length: 501 }, (_, index) => ({
    task_id: index + 1,
  }));
  const range = vi
    .fn()
    .mockResolvedValueOnce({ data: ids.slice(0, 500), error: null })
    .mockResolvedValueOnce({ data: ids.slice(500), error: null });
  mocks.rpc.mockReturnValue({ range });
  const filter = vi.fn().mockImplementation((_column, values: number[]) =>
    Promise.resolve({
      data: values.map((id) => taskRow({ id })),
      error: null,
    }),
  );
  mocks.from.mockReturnValue({ select: () => ({ in: filter }) });
  await expect(fetchManagedTasks()).resolves.toHaveLength(501);
  expect(range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
  ]);
  expect(filter).toHaveBeenCalledTimes(6);
  expect(filter).toHaveBeenLastCalledWith('id', [501]);
  expect(mocks.rpc).toHaveBeenCalledWith('my_managed_task_ids');
});

it('propagates a capability read failure without falling back to a broad Tasks query', async () => {
  const error = new Error('read denied');
  mocks.rpc.mockReturnValue({
    range: vi.fn().mockResolvedValue({ data: null, error }),
  });
  await expect(fetchManagedTasks()).rejects.toBe(error);
  expect(mocks.from).not.toHaveBeenCalled();
});
