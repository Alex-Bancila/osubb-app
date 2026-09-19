import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { fetchTaskFormOptions } from './task-form-options';
it('pages server-managed origins and readable active campaigns/umbrellas without writes', async () => {
  const calls: unknown[] = [];
  function builder(table: string) {
    const query = {
      select: (fields: string) => {
        calls.push([table, 'select', fields]);
        return query;
      },
      eq: (field: string, value: unknown) => {
        calls.push([table, 'eq', field, value]);
        return query;
      },
      in: (field: string, value: unknown) => {
        calls.push([table, 'in', field, value]);
        return query;
      },
      order: (field: string) => {
        calls.push([table, 'order', field]);
        return query;
      },
      range: async (from: number, to: number) => {
        calls.push([table, 'range', from, to]);
        return {
          data:
            table === 'managed_work_groups'
              ? Array.from({ length: from === 0 ? 500 : 1 }, (_, i) => ({
                  id: from + i + 1,
                  name: 'Grup',
                  path: [from + i + 1],
                  min_level: 0,
                  category: 'team',
                }))
              : table === 'campaigns'
                ? [
                    { id: 10, name: 'Campanie', group_id: 1, is_active: true },
                    { id: 11, name: 'Inactivă', group_id: 1, is_active: false },
                  ]
                : [
                    { id: 20, title: 'Umbrelă administrată', group_id: 501 },
                    { id: 21, title: 'Doar vizibilă', group_id: 999 },
                  ],
          error: null,
        };
      },
    };
    return query;
  }
  api.rpc.mockImplementation(builder);
  api.from.mockImplementation(builder);
  const data = await fetchTaskFormOptions();
  expect(data.groups).toHaveLength(501);
  expect(calls).toContainEqual(['managed_work_groups', 'range', 500, 999]);
  expect(data.campaigns.map((row) => row.id)).toEqual([10]);
  expect(calls).toContainEqual(['tasks', 'eq', 'kind', 'umbrella']);
  expect(calls).toContainEqual([
    'tasks',
    'in',
    'status',
    ['todo', 'in_progress', 'in_review'],
  ]);
  expect(data.umbrellas).toEqual([
    { id: 20, title: 'Umbrelă administrată', group_id: 501 },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('managed_work_groups');
});
it('returns no form options for a successful lack of managed origins', async () => {
  const query = {
    order: () => query,
    range: async () => ({ data: [], error: null }),
  };
  api.rpc.mockReturnValue(query);
  expect(await fetchTaskFormOptions()).toEqual({
    groups: [],
    campaigns: [],
    umbrellas: [],
  });
  expect(api.from).not.toHaveBeenCalled();
});
it('does not expose partial options if the capability read fails', async () => {
  const query = {
    order: () => query,
    range: async () => ({ data: null, error: new Error('offline') }),
  };
  api.rpc.mockReturnValue(query);
  await expect(fetchTaskFormOptions()).rejects.toThrow('offline');
  expect(api.from).not.toHaveBeenCalled();
});
