import { QueryClient } from '@tanstack/react-query';
import { keys } from './keys';
import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  duplicateTask,
  taskDuplicationMutationOptions,
} from './task-duplication';

describe('Task duplication command', () => {
  it('sends only the source and deadline and returns the new task id', async () => {
    rpc.mockResolvedValue({ data: { id: 42 }, error: null });
    expect(
      await duplicateTask({ taskId: 1, deadline: '2026-10-20T09:30:00.000Z' }),
    ).toEqual({ id: 42 });
    expect(rpc).toHaveBeenCalledWith('duplicate_task', {
      p_task_id: 1,
      p_deadline: '2026-10-20T09:30:00.000Z',
    });
  });
  it.each(['PT400', 'PT404', 'PT409', '42501', 'XX000'])(
    'does not expose the %s payload',
    async (code) => {
      const failure = { code, message: 'private database information' };
      rpc.mockResolvedValue({ data: null, error: failure });
      await expect(
        duplicateTask({ taskId: 1, deadline: '2026-10-20T09:30:00.000Z' }),
      ).rejects.toEqual(failure);
    },
  );
});

it('refreshes Task reads after a denied mutation', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const failure = { message: 'task_manage_forbidden' };
  rpc.mockResolvedValue({ data: null, error: failure });
  const mutation = client
    .getMutationCache()
    .build(client, taskDuplicationMutationOptions(client));
  await expect(
    mutation.execute({ taskId: 1, deadline: '2026-10-01T00:00:00Z' }),
  ).rejects.toEqual(failure);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all });
});
