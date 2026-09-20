import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import { convertTaskMode, fetchTaskParticipation } from './task-mode';

beforeEach(() => {
  api.rpc.mockReset();
  api.from.mockReset();
});

it('sends every Mode and Audience combination to the command and nothing else', async () => {
  api.rpc.mockResolvedValue({ data: { id: 1 }, error: null });
  const combinations = [
    { assignmentMode: 'direct', audience: 'local' },
    { assignmentMode: 'direct', audience: 'org' },
    { assignmentMode: 'public', audience: 'local' },
    { assignmentMode: 'public', audience: 'org' },
  ] as const;
  for (const combination of combinations) {
    await convertTaskMode({ taskId: 4, ...combination });
    expect(api.rpc).toHaveBeenLastCalledWith('convert_task_mode', {
      p_task_id: 4,
      p_assignment_mode: combination.assignmentMode,
      p_audience: combination.audience,
    });
  }
  expect(api.rpc).toHaveBeenCalledTimes(4);
});

it('translates every refusal the command can raise, without backend details', async () => {
  const reasons = [
    ['PT409', 'task_already_assigned', 'are deja un executor'],
    ['PT409', 'task_has_candidates', 'înscris deja în coada taskului'],
    ['PT409', 'task_is_umbrella', 'Taskul-umbrelă'],
    ['PT409', 'task_terminal', 'Taskul a fost finalizat'],
    ['PT400', 'invalid_audience', 'audiență validă'],
    ['PT400', 'invalid_assignment_mode', 'mod de atribuire valid'],
    ['42501', 'task_manage_forbidden', 'Nu mai ai permisiunea'],
    ['XX000', 'stack depth limit exceeded', 'Nu am putut schimba modul'],
  ] as const;
  for (const [code, message, copy] of reasons) {
    api.rpc.mockResolvedValue({ error: { code, message } });
    await expect(
      convertTaskMode({
        taskId: 4,
        assignmentMode: 'public',
        audience: 'local',
      }),
    ).rejects.toThrow(copy);
  }
});

it('reads participation from both history tables without filtering by status', async () => {
  const limit = vi.fn();
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit,
  };
  api.from.mockReturnValue(builder);
  limit
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [{ id: 9 }], error: null });
  expect(await fetchTaskParticipation(4)).toEqual({
    assigned: false,
    hasCandidates: true,
  });
  expect(api.from).toHaveBeenNthCalledWith(1, 'task_assignments');
  expect(api.from).toHaveBeenNthCalledWith(2, 'task_candidates');
  expect(builder.eq).toHaveBeenCalledWith('task_id', 4);
  expect(builder.eq).toHaveBeenCalledTimes(2);
});
