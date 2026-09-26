import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { decideRequest, fetchPendingDecisions } from './request-decisions';
it('sends approval scoring and mandatory note only through commands', async () => {
  api.rpc.mockResolvedValue({ data: { id: 1 }, error: null });
  await decideRequest({
    kind: 'approve',
    requestId: 7,
    difficulty: 2,
    rating: 5,
    note: ' Bine ',
  });
  expect(api.rpc).toHaveBeenCalledWith('approve_completed_work_request', {
    p_request_id: 7,
    p_difficulty: 2,
    p_rating: 5,
    p_note: 'Bine',
  });
  await decideRequest({
    kind: 'reject',
    requestId: 8,
    note: ' Lipsesc dovezi ',
  });
  expect(api.rpc).toHaveBeenLastCalledWith('reject_completed_work_request', {
    p_request_id: 8,
    p_note: 'Lipsesc dovezi',
  });
});
it('rejects blank or long notes and invalid scoring before a request', async () => {
  await expect(
    decideRequest({ kind: 'reject', requestId: 8, note: ' ' }),
  ).rejects.toMatchObject({ reason: 'note_required' });
  await expect(
    decideRequest({ kind: 'reject', requestId: 8, note: 'x'.repeat(1001) }),
  ).rejects.toMatchObject({ reason: 'note_too_long' });
  await expect(
    decideRequest({
      kind: 'approve',
      requestId: 8,
      difficulty: 0,
      rating: 5,
      note: 'N',
    }),
  ).rejects.toThrow('Dificultate între 1 și 5');
  expect(api.rpc).not.toHaveBeenCalled();
});
it('maps already-decided errors safely', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT409', message: 'request_not_pending' },
  });
  await expect(
    decideRequest({ kind: 'reject', requestId: 8, note: 'N' }),
  ).rejects.toThrow('Cererea a fost deja decisă');
});
it('pages the authority-filtered queue and rejects partial failures', async () => {
  let calls = 0;
  const builder = {
    order: () => builder,
    range: async () => {
      calls++;
      return calls === 1
        ? {
            data: Array.from({ length: 500 }, (_, id) => ({ id })),
            error: null,
          }
        : { data: null, error: new Error('offline') };
    },
  };
  api.rpc.mockReturnValue(builder);
  await expect(fetchPendingDecisions()).rejects.toThrow('offline');
  expect(calls).toBe(2);
  expect(api.rpc).toHaveBeenCalledWith('pending_request_decisions');
});
