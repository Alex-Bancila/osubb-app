import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { fetchTaskDetails } from './task-details';
import { taskRow } from '../test/task-fixtures';
it('stops on a hidden or missing Task before asking for its relations', async () => {
  const eq = vi.fn(() => ({
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  }));
  api.from.mockReturnValue({ select: () => ({ eq }) });
  await expect(fetchTaskDetails(77)).resolves.toBeNull();
  expect(eq).toHaveBeenCalledWith('id', 77);
  expect(api.from).toHaveBeenCalledOnce();
  expect(api.rpc).not.toHaveBeenCalled();
});

it('uses the safe Executor endpoint instead of querying a profile per Task', async () => {
  const task = taskRow();
  api.from.mockImplementation((table: string) => {
    if (table === 'tasks')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: task, error: null }),
          }),
        }),
      };
    if (table === 'profiles_directory')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { full_name: 'Profil vechi' },
                error: null,
              }),
          }),
        }),
      };
    throw new Error(`Unexpected table: ${table}`);
  });
  api.rpc.mockResolvedValue({
    data: [{ task_id: 1, member_id: 'member', full_name: 'Executor Sigur' }],
    error: null,
  });

  await expect(fetchTaskDetails(1)).resolves.toMatchObject({
    task: {
      visibleExecutor: {
        memberId: 'member',
        fullName: 'Executor Sigur',
      },
    },
    executorName: 'Executor Sigur',
  });
  expect(api.rpc).toHaveBeenCalledWith('visible_task_executors', {
    p_task_ids: [1],
  });
  expect(api.from).not.toHaveBeenCalledWith('profiles_directory');
});
