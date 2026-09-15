import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
const reads = vi.hoisted(() => ({
  fetchOwnCandidature: vi.fn(),
  fetchOwnQueuePosition: vi.fn(),
}));
vi.mock('./task-interest', () => ({ ...reads, TaskInterestError: Error }));
import { fetchTaskQueue } from './task-queue';

describe('Own queue reads', () => {
  it('uses the private-safe server position for pending Candidates', async () => {
    reads.fetchOwnCandidature.mockResolvedValue({ status: 'pending' });
    reads.fetchOwnQueuePosition.mockResolvedValue(8);
    await expect(fetchTaskQueue(1, 'member')).resolves.toEqual({
      status: 'pending',
      position: 8,
    });
    expect(reads.fetchOwnCandidature).toHaveBeenCalledWith(1, 'member');
  });
  it.each(['selected', 'withdrawn', 'closed'])(
    'does not display a stale position after %s',
    async (status) => {
      reads.fetchOwnCandidature.mockResolvedValue({ status });
      await expect(fetchTaskQueue(1, 'member')).resolves.toEqual({
        status,
        position: null,
      });
      expect(reads.fetchOwnQueuePosition).not.toHaveBeenCalled();
    },
  );
});
