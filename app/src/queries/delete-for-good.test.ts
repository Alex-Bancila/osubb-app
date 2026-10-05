import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
import {
  DeleteRefusal,
  deleteCampaign,
  deleteEvent,
  deleteGroup,
  deleteTask,
  fetchGroupDeletePreview,
  fetchTaskDeletePreview,
  groupIsEmpty,
  useDeleteTask,
} from './delete-for-good';
import { keys } from './keys';

beforeEach(() => rpc.mockReset());

it('reads a Task’s preview and sends task_delete_preview', async () => {
  rpc.mockResolvedValue({
    data: {
      subtasks: 2,
      total: 20,
      members: [
        { member_id: 'a', points: 12 },
        { member_id: 'b', points: 8 },
      ],
    },
    error: null,
  });
  await expect(fetchTaskDeletePreview(17)).resolves.toEqual({
    subtasks: 2,
    total: 20,
    members: [
      { memberId: 'a', points: 12 },
      { memberId: 'b', points: 8 },
    ],
  });
  expect(rpc).toHaveBeenCalledWith('task_delete_preview', { p_task_id: 17 });
});

it('sends delete_task with or without the points, and reads the net change', async () => {
  rpc.mockResolvedValue({
    data: { deleted_tasks: 3, points_reversed: -12, members: 1 },
    error: null,
  });
  await expect(deleteTask({ taskId: 17, withPoints: true })).resolves.toEqual({
    deletedTasks: 3,
    pointsReversed: -12,
    members: 1,
  });
  expect(rpc).toHaveBeenCalledWith('delete_task', {
    p_task_id: 17,
    p_with_points: true,
  });
  await deleteTask({ taskId: 17, withPoints: false });
  expect(rpc).toHaveBeenLastCalledWith('delete_task', {
    p_task_id: 17,
    p_with_points: false,
  });
});

it('carries the points a task_has_points refusal names', async () => {
  rpc.mockResolvedValue({
    data: null,
    error: {
      code: 'PT409',
      message: 'task_has_points',
      details: '{"total": 5, "members": [{"member_id": "a", "points": 5}]}',
    },
  });
  const failure = await deleteTask({ taskId: 17, withPoints: false }).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(DeleteRefusal);
  expect((failure as DeleteRefusal).reason).toBe('task_has_points');
  expect((failure as DeleteRefusal).points).toEqual({
    total: 5,
    members: [{ memberId: 'a', points: 5 }],
  });
  expect((failure as DeleteRefusal).message).toMatch('Alege dacă le retragi');
});

it('turns any other refusal into Romanian, never the raw reason', async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'task_manage_forbidden' },
  });
  await expect(deleteTask({ taskId: 1, withPoints: false })).rejects.toThrow(
    'Nu mai ai permisiunea să gestionezi taskurile acestui grup.',
  );
  rpc.mockResolvedValue({
    data: null,
    error: { code: 'XX000', message: 'x y' },
  });
  await expect(deleteTask({ taskId: 1, withPoints: false })).rejects.toThrow(
    'Nu am putut șterge taskul. Încearcă din nou.',
  );
});

it('sends delete_event and delete_campaign with their ids', async () => {
  rpc.mockResolvedValue({ data: { rsvps: 4 }, error: null });
  await expect(deleteEvent(31)).resolves.toEqual({ rsvps: 4 });
  expect(rpc).toHaveBeenCalledWith('delete_event', { p_event_id: 31 });
  rpc.mockResolvedValue({ data: { tasks: 3, events: 1 }, error: null });
  await expect(deleteCampaign(10)).resolves.toEqual({ tasks: 3, events: 1 });
  expect(rpc).toHaveBeenCalledWith('delete_campaign', { p_campaign_id: 10 });
  rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT404', message: 'event_not_found' },
  });
  await expect(deleteEvent(31)).rejects.toThrow(
    'Evenimentul nu mai este disponibil.',
  );
});

it('reads a Group’s preview and sends delete_group with its mode', async () => {
  const summary = {
    subgroups: 0,
    members: 3,
    tasks: 0,
    tasks_with_points: 0,
    points: 0,
    point_members: 0,
    events: 0,
    announcements: 0,
    campaigns: 0,
    applications: 0,
    requests: 0,
    protected: false,
  };
  rpc.mockResolvedValue({ data: summary, error: null });
  const preview = await fetchGroupDeletePreview(2);
  expect(rpc).toHaveBeenCalledWith('group_delete_preview', { p_group_id: 2 });
  expect(preview.members).toBe(3);
  // Roster Members do not count: the Group is empty.
  expect(groupIsEmpty(preview)).toBe(true);
  expect(groupIsEmpty({ ...preview, announcements: 1 })).toBe(false);
  expect(groupIsEmpty({ ...preview, requests: 1 })).toBe(false);

  rpc.mockResolvedValue({
    data: { ...summary, mode: 'empty', points_reversed: 0 },
    error: null,
  });
  await deleteGroup({ groupId: 2, mode: 'empty' });
  expect(rpc).toHaveBeenCalledWith('delete_group', {
    p_group_id: 2,
    p_mode: 'empty',
  });
  rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT409', message: 'group_protected' },
  });
  await expect(deleteGroup({ groupId: 1, mode: 'everything' })).rejects.toThrow(
    /nu poate fi șters definitiv/,
  );
});

it('refreshes the lists after a Task delete but leaves the deleted Task’s reads unfetched', async () => {
  rpc.mockResolvedValue({
    data: { deleted_tasks: 1, points_reversed: -5, members: 1 },
    error: null,
  });
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useDeleteTask(), { wrapper });
  await result.current.mutateAsync({ taskId: 17, withPoints: true });
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const calls = spy.mock.calls.map(([filters]) => filters);
  for (const family of [
    keys.points.all,
    keys.notifications.all,
    keys.campaigns.all,
  ])
    expect(calls).toContainEqual({ queryKey: family });
  const lists = calls.find(
    (filters) => filters?.queryKey === keys.tasks.all,
  ) as unknown as {
    predicate: (query: { queryKey: readonly unknown[] }) => boolean;
  };
  expect(lists.predicate({ queryKey: keys.tasks.mine('me') })).toBe(true);
  expect(lists.predicate({ queryKey: keys.tasks.detail(17, 'me') })).toBe(
    false,
  );
  expect(calls).toContainEqual(
    expect.objectContaining({ refetchType: 'none' }),
  );
});
