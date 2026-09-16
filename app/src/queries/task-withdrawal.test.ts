import { expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { withdrawTaskInterest } from './task-withdrawal';
it('withdraws by Task id only, without a member id or reason', async () => {
  rpc.mockResolvedValue({ error: null });
  await withdrawTaskInterest(8);
  expect(rpc).toHaveBeenCalledWith('withdraw_task_interest', { p_task_id: 8 });
});
