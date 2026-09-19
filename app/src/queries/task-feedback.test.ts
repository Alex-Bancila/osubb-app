import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { returnTaskToProgress } from './task-feedback';
beforeEach(() =>
  rpc.mockReset().mockResolvedValue({ data: { id: 17 }, error: null }),
);
it('uses only the feedback command and trims the note', async () => {
  await returnTaskToProgress({ taskId: 17, note: '  Surse  ' });
  expect(rpc).toHaveBeenCalledWith('return_task_to_progress', {
    p_task_id: 17,
    p_note: 'Surse',
  });
});
it('does not send blank feedback and translates conflicts', async () => {
  await expect(returnTaskToProgress({ taskId: 17, note: ' ' })).rejects.toThrow(
    'Scrie o notă',
  );
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: { code: 'PT409' } });
  await expect(
    returnTaskToProgress({ taskId: 17, note: 'Surse' }),
  ).rejects.toThrow('s-a schimbat');
});
