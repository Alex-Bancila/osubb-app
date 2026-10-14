import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: mocks }));
import { fetchTaskLeadership } from './task-tabs';

beforeEach(() => vi.clearAllMocks());

it('reads the all-Tasks capability from the server', async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  await expect(fetchTaskLeadership()).resolves.toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith('can_read_all_tasks');
});

it('propagates a leadership capability failure', async () => {
  const error = new Error('capability denied');
  mocks.rpc.mockResolvedValue({ data: null, error });
  await expect(fetchTaskLeadership()).rejects.toBe(error);
});
