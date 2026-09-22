import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { cancelTask } from './task-cancel';
beforeEach(() =>
  rpc.mockReset().mockResolvedValue({ data: { id: 17 }, error: null }),
);
it('uses only the reason command and trims the note', async () => {
  await cancelTask({ taskId: 17, reason: '  Surse  ' });
  expect(rpc).toHaveBeenCalledWith('cancel_task', {
    p_task_id: 17,
    p_reason: 'Surse',
  });
});
it('does not send blank reason and translates conflicts', async () => {
  await expect(cancelTask({ taskId: 17, reason: ' ' })).rejects.toThrow(
    'Scrie motivul',
  );
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: { code: 'PT409' } });
  await expect(cancelTask({ taskId: 17, reason: 'Surse' })).rejects.toThrow(
    's-a schimbat',
  );
  rpc.mockResolvedValue({ error: { code: '42501' } });
  await expect(cancelTask({ taskId: 17, reason: 'Surse' })).rejects.toThrow(
    'permisiunea de a anula',
  );
  rpc.mockResolvedValue({ error: { code: 'XX000' } });
  await expect(cancelTask({ taskId: 17, reason: 'Surse' })).rejects.toThrow(
    'Nu am putut anula taskul',
  );
});
