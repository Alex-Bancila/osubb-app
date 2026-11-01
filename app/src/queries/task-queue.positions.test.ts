import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrest } from '../test/postgrest-fake';

vi.mock('../lib/supabase', async () => ({
  supabase: (await import('../test/postgrest-fake')).postgrest.client,
}));

import { fetchQueuePositions } from './task-queue';

beforeEach(() => postgrest.reset());

/** The `task_id` list one request asked for. */
const asked = (index: number) =>
  postgrest
    .argsOf(postgrest.requestsTo('task_queue_summary')[index], 'in')
    .find(([column]) => column === 'task_id')?.[1] as number[] | undefined;

describe('fetchQueuePositions (#1133)', () => {
  it('reads the places a hundred Tasks a request, leaving out a Task with none', async () => {
    postgrest.serve('task_queue_summary', (request) => {
      const ids = (postgrest
        .argsOf(request, 'in')
        .find(([column]) => column === 'task_id')?.[1] ?? []) as number[];
      return ids.map((taskId) => ({
        task_id: taskId,
        my_position: taskId % 50 === 0 ? null : taskId,
      }));
    });
    const ids = Array.from({ length: 150 }, (_, index) => index + 1);

    const positions = await fetchQueuePositions(ids);

    expect(postgrest.requestsTo('task_queue_summary')).toHaveLength(2);
    expect(asked(0)).toHaveLength(100);
    expect(asked(1)).toEqual(ids.slice(100));
    expect(positions.get(7)).toBe(7);
    expect(positions.has(50)).toBe(false);
    expect(positions.size).toBe(147);
  });

  it('fails the whole read when a request fails', async () => {
    postgrest.serve('task_queue_summary', new Error('permission denied'));
    await expect(fetchQueuePositions([1, 2])).rejects.toThrow(
      'permission denied',
    );
  });
});
