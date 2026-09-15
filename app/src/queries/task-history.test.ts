import { expect, it, vi } from 'vitest';
const from = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { from } }));
import { fetchTaskHistory } from './task-history';
it('reads only the target Task history and never fabricates hidden actors', async () => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({
    data: [{ id: 1, actor_id: 'hidden' }],
    error: null,
  });
  from.mockImplementation((table) =>
    table === 'task_activity'
      ? query
      : {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        },
  );
  expect(await fetchTaskHistory(8)).toEqual([
    { id: 1, actor_id: 'hidden', actorName: null },
  ]);
  expect(query.eq).toHaveBeenCalledWith('task_id', 8);
});
