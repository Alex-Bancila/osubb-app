import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
const reads = vi.hoisted(() => ({
  fetchOwnCandidature: vi.fn(),
  hasOwnActiveAssignment: vi.fn(),
  fetchOwnQueuePosition: vi.fn(),
}));
vi.mock('./task-interest', () => ({ ...reads, TaskInterestError: Error }));
import { fetchTaskQueue } from './task-queue';

describe('Own queue reads', () => {
  it('shows a directly assigned first participant as selected without a Candidate row', async () => {
    reads.hasOwnActiveAssignment.mockResolvedValueOnce(true);
    await expect(fetchTaskQueue(1, 'member')).resolves.toEqual({
      status: 'selected',
      position: null,
    });
    expect(reads.fetchOwnCandidature).not.toHaveBeenCalled();
  });
  it('uses the private-safe server position for pending Candidates', async () => {
    reads.fetchOwnCandidature.mockResolvedValue({ status: 'pending' });
    reads.fetchOwnQueuePosition.mockResolvedValue(8);
    await expect(fetchTaskQueue(1, 'member')).resolves.toEqual({
      status: 'pending',
      position: 8,
    });
    expect(reads.fetchOwnCandidature).toHaveBeenCalledWith(1, 'member');
  });
  /* Audit D-3: after a give-up the Candidature still says `selected`, but the
     Member holds no Assignment — "Ai fost selectat" would be untrue. */
  it('reads a selected Candidature without an open Assignment as no candidature', async () => {
    reads.hasOwnActiveAssignment.mockResolvedValueOnce(false);
    reads.fetchOwnCandidature.mockResolvedValue({ status: 'selected' });
    await expect(fetchTaskQueue(1, 'member')).resolves.toEqual({
      status: null,
      position: null,
    });
  });
  it.each(['withdrawn', 'closed'])(
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
