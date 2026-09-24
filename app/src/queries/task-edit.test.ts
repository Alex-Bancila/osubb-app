import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  TaskEditNeedsConfirmation,
  previewTaskUpdate,
  updateTask,
  type TaskUpdateInput,
} from './task-edit';

const input: TaskUpdateInput = {
  taskId: 1,
  groupId: 2,
  title: ' Titlu ',
  description: ' ',
  deadline: null,
  campaignId: null,
  assignmentMode: 'direct',
  audience: 'local',
};
const args = {
  p_task_id: 1,
  p_group_id: 2,
  p_title: 'Titlu',
  p_description: null,
  p_deadline: null,
  p_campaign_id: null,
  p_assignment_mode: 'direct',
  p_audience: 'local',
};
beforeEach(() => vi.resetAllMocks());

it('sends every field as a full replacement value to update_task, NULL clears included', async () => {
  api.rpc.mockResolvedValue({ data: { id: 1 }, error: null });
  await updateTask({ ...input, acceptConsequences: false });
  expect(api.rpc).toHaveBeenCalledWith('update_task', {
    ...args,
    p_accept_consequences: false,
  });
  await updateTask({ ...input, acceptConsequences: true });
  expect(api.rpc).toHaveBeenLastCalledWith('update_task', {
    ...args,
    p_accept_consequences: true,
  });
});

it('previews with the same values and names each affected member', async () => {
  api.rpc.mockResolvedValue({
    data: [
      { consequence: 'executor_removed', member_id: 'a' },
      { consequence: 'executor_added_to_group', member_id: 'b' },
      { consequence: 'candidate_removed', member_id: 'z' },
    ],
    error: null,
  });
  const inIds = vi.fn().mockResolvedValue({
    data: [
      { id: 'a', full_name: 'Ana Șerban' },
      { id: 'b', full_name: 'Bianca Pop' },
    ],
    error: null,
  });
  api.from.mockReturnValue({ select: () => ({ in: inIds }) });
  expect(await previewTaskUpdate(input)).toEqual([
    { kind: 'executor_removed', memberId: 'a', memberName: 'Ana Șerban' },
    {
      kind: 'executor_added_to_group',
      memberId: 'b',
      memberName: 'Bianca Pop',
    },
    { kind: 'candidate_removed', memberId: 'z', memberName: 'Un membru' },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('preview_task_update', args);
  expect(api.from).toHaveBeenCalledWith('profiles_directory');
  expect(inIds).toHaveBeenCalledWith('id', ['a', 'b', 'z']);
});

it('shows a campaign-only consequence without querying member names', async () => {
  api.rpc.mockResolvedValue({
    data: [{ consequence: 'campaign_cleared', member_id: null }],
    error: null,
  });
  expect(await previewTaskUpdate(input)).toEqual([
    { kind: 'campaign_cleared', memberId: null, memberName: 'Un membru' },
  ]);
  expect(api.from).not.toHaveBeenCalled();
});

it('falls back when directory lookup returns no data', async () => {
  api.rpc.mockResolvedValue({
    data: [{ consequence: 'executor_added_to_group', member_id: 'a' }],
    error: null,
  });
  api.from.mockReturnValue({
    select: () => ({
      in: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'offline' } }),
    }),
  });
  expect(await previewTaskUpdate(input)).toEqual([
    { kind: 'executor_added_to_group', memberId: 'a', memberName: 'Un membru' },
  ]);
});

it('reads no names when the edit affects nobody', async () => {
  api.rpc.mockResolvedValue({ data: [], error: null });
  expect(await previewTaskUpdate(input)).toEqual([]);
  expect(api.from).not.toHaveBeenCalled();
});

it('maps refusals to safe copy and flags a needed confirmation', async () => {
  api.rpc.mockResolvedValue({
    error: { code: 'PT409', message: 'task_in_review', details: 'SQL' },
  });
  await expect(
    updateTask({ ...input, acceptConsequences: false }),
  ).rejects.toThrow('în verificare');
  api.rpc.mockResolvedValue({
    error: { code: '42501', message: 'task_manage_forbidden' },
  });
  await expect(previewTaskUpdate(input)).rejects.toThrow(
    'Nu mai ai permisiunea de a edita',
  );
  api.rpc.mockResolvedValue({
    error: { code: 'PT409', message: 'task_update_needs_confirmation' },
  });
  await expect(
    updateTask({ ...input, acceptConsequences: false }),
  ).rejects.toBeInstanceOf(TaskEditNeedsConfirmation);
  api.rpc.mockResolvedValue({
    error: { code: 'XX000', message: 'private detail' },
  });
  await expect(
    updateTask({ ...input, acceptConsequences: false }),
  ).rejects.toThrow('Nu am putut salva modificările');
});
