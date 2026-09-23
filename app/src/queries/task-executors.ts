import { supabase } from '../lib/supabase';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/**
 * Adds the deliberately narrow Executor identity returned by #499's RPC.
 * One request enriches an entire result set; Task cards never fetch profiles.
 */
export async function attachVisibleTaskExecutors(
  rows: TaskPresentationRow[],
): Promise<TaskPresentationRow[]> {
  if (!rows.length) return rows;

  const taskIds = [...new Set(rows.map((row) => row.id))];
  const { data, error } = await supabase.rpc('visible_task_executors', {
    p_task_ids: taskIds,
  });
  if (error) throw error;

  const byTask = new Map(
    data.map((executor) => [
      executor.task_id,
      {
        memberId: executor.member_id,
        fullName: executor.full_name?.trim() || null,
        nickname: executor.nickname?.trim() || null,
      },
    ]),
  );

  return rows.map((row) => ({
    ...row,
    visibleExecutor: byTask.get(row.id) ?? null,
  }));
}
