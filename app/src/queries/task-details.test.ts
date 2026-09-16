import { expect, it, vi } from 'vitest';
const from = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { from } }));
import { fetchTaskDetails } from './task-details';
it('stops on a hidden or missing Task before asking for its relations', async () => {
  const eq = vi.fn(() => ({
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  }));
  from.mockReturnValue({ select: () => ({ eq }) });
  await expect(fetchTaskDetails(77)).resolves.toBeNull();
  expect(eq).toHaveBeenCalledWith('id', 77);
  expect(from).toHaveBeenCalledOnce();
});
