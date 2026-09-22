import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));

import {
  fetchPendingTaskCandidates,
  selectTaskCandidate,
  taskCandidateSelectionError,
} from './task-candidate-selection';

beforeEach(() => vi.clearAllMocks());

it('loads only pending candidates for one Task in queue order', async () => {
  const secondOrder = vi.fn().mockResolvedValue({
    data: [
      {
        id: 31,
        member_id: 'member-1',
        joined_at: '2026-09-18T08:00:00Z',
        member: { full_name: 'Ana Pop', avatar_color: '#0055aa' },
      },
      {
        id: 32,
        member_id: 'member-2',
        joined_at: '2026-09-18T08:00:00Z',
        member: { full_name: 'Mihai Ionescu' },
      },
    ],
    error: null,
  });
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const statusFilter = vi.fn(() => ({ order: firstOrder }));
  const taskFilter = vi.fn(() => ({ eq: statusFilter }));
  const select = vi.fn(() => ({ eq: taskFilter }));
  api.from.mockReturnValue({ select });

  await expect(fetchPendingTaskCandidates(17)).resolves.toEqual([
    {
      id: 31,
      memberId: 'member-1',
      memberName: 'Ana Pop',
      avatarColor: '#0055aa',
      joinedAt: '2026-09-18T08:00:00Z',
    },
    {
      id: 32,
      memberId: 'member-2',
      memberName: 'Mihai Ionescu',
      avatarColor: null,
      joinedAt: '2026-09-18T08:00:00Z',
    },
  ]);
  expect(api.from).toHaveBeenCalledWith('task_candidates');
  expect(taskFilter).toHaveBeenCalledWith('task_id', 17);
  expect(statusFilter).toHaveBeenCalledWith('status', 'pending');
  expect(firstOrder).toHaveBeenCalledWith('joined_at', { ascending: true });
  expect(secondOrder).toHaveBeenCalledWith('id', { ascending: true });
});

it('selects by Task and candidate ids and keeps the remaining queue open', async () => {
  api.rpc.mockResolvedValue({ data: { id: 17 }, error: null });

  await expect(selectTaskCandidate(17, 31)).resolves.toEqual({ id: 17 });

  expect(api.rpc).toHaveBeenCalledWith('select_task_candidate', {
    p_task_id: 17,
    p_candidate_id: 31,
    p_close_remaining: false,
  });
});

it('maps stable command codes to safe Romanian failures', () => {
  expect(taskCandidateSelectionError('PT400').message).toBe(
    'Alege un candidat valid din coadă.',
  );
  expect(taskCandidateSelectionError('PT404').message).toBe(
    'Candidatura sau taskul nu mai este disponibil.',
  );
  expect(taskCandidateSelectionError('PT409').message).toBe(
    'Coada s-a schimbat. Lista a fost actualizată.',
  );
  expect(taskCandidateSelectionError('42501').message).toBe(
    'Nu ai permisiunea să alegi executorul acestui task.',
  );
  expect(taskCandidateSelectionError('XX000').message).not.toContain('XX000');
});
