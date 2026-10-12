import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  approveAnnouncement,
  approveEvent,
  fetchApprovalRequests,
  rejectAnnouncement,
  rejectEvent,
} from './approvals';

it('lists the Cereri de aprobare from approval_requests, in the server’s order', async () => {
  api.rpc.mockResolvedValue({
    data: [
      {
        kind: 'event',
        id: 7,
        title: 'Gala',
        group_id: 1,
        created_by: 'ana',
        created_at: '2026-10-11T10:00:00Z',
        starts_at: '2026-11-01T18:00:00Z',
      },
      {
        kind: 'announcement',
        id: 3,
        title: 'Burse',
        group_id: 1,
        created_by: 'dan',
        created_at: '2026-10-11T09:00:00Z',
        starts_at: null,
      },
    ],
    error: null,
  });
  expect(await fetchApprovalRequests()).toEqual([
    {
      kind: 'event',
      id: 7,
      title: 'Gala',
      groupId: 1,
      createdBy: 'ana',
      createdAt: '2026-10-11T10:00:00Z',
      startsAt: '2026-11-01T18:00:00Z',
    },
    {
      kind: 'announcement',
      id: 3,
      title: 'Burse',
      groupId: 1,
      createdBy: 'dan',
      createdAt: '2026-10-11T09:00:00Z',
      startsAt: null,
    },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('approval_requests');
});

it('approves and rejects through the four commands, with the id and the reason', async () => {
  api.rpc.mockResolvedValue({ data: { id: 3 }, error: null });
  await approveAnnouncement({ id: 3 });
  expect(api.rpc).toHaveBeenLastCalledWith('approve_announcement', { p_id: 3 });
  await rejectAnnouncement({ id: 3, reason: 'Lipsesc detaliile.' });
  expect(api.rpc).toHaveBeenLastCalledWith('reject_announcement', {
    p_id: 3,
    p_reason: 'Lipsesc detaliile.',
  });
  await approveEvent({ id: 7 });
  expect(api.rpc).toHaveBeenLastCalledWith('approve_event', { p_id: 7 });
  await rejectEvent({ id: 7, reason: 'Data e greșită.' });
  expect(api.rpc).toHaveBeenLastCalledWith('reject_event', {
    p_id: 7,
    p_reason: 'Data e greșită.',
  });
});

it('turns a refusal into its Romanian copy, keeping the reason', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT400', message: 'rejection_reason_required' },
  });
  await expect(rejectEvent({ id: 7, reason: '' })).rejects.toMatchObject({
    reason: 'rejection_reason_required',
    message: 'Scrie motivul respingerii.',
  });
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT409', message: 'not_pending' },
  });
  await expect(approveAnnouncement({ id: 3 })).rejects.toMatchObject({
    reason: 'not_pending',
    message: 'Cererea a fost deja decisă.',
  });
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'approval_forbidden' },
  });
  await expect(approveEvent({ id: 7 })).rejects.toMatchObject({
    reason: 'approval_forbidden',
    message: 'Doar BC și Moderatorul aprobă sau resping.',
  });
});
