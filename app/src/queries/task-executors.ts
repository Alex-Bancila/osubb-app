import { supabase } from '../lib/supabase';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/** The RPC refuses more ids than this per call (PT400 too_many_ids). */
export const VISIBLE_EXECUTORS_BATCH = 200;

/**
 * Adds the deliberately narrow Executor identity returned by #499's RPC: the
 * open Assignment's member, or the member who finished a completed or
 * unfulfilled Task (#861). One request per 200 Task ids enriches an entire
 * result set; Task cards never fetch profiles.
 */
export async function attachVisibleTaskExecutors<
  Row extends TaskPresentationRow,
>(rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;

  const taskIds = [...new Set(rows.map((row) => row.id))];
  const batches: number[][] = [];
  for (
    let start = 0;
    start < taskIds.length;
    start += VISIBLE_EXECUTORS_BATCH
  ) {
    batches.push(taskIds.slice(start, start + VISIBLE_EXECUTORS_BATCH));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      supabase.rpc('visible_task_executors', { p_task_ids: batch }),
    ),
  );
  const data = results.flatMap((result) => {
    if (result.error) throw result.error;
    return result.data;
  });

  const byTask = new Map(
    data.map((executor) => [
      executor.task_id,
      {
        memberId: executor.member_id,
        fullName: executor.full_name?.trim() || null,
        nickname: executor.nickname?.trim() || null,
        // #861: false for the Executor who finished a completed or
        // unfulfilled Task, whose Assignment the Evaluation ended.
        isCurrent: executor.is_current,
      },
    ]),
  );

  return rows.map((row) => ({
    ...row,
    visibleExecutor: byTask.get(row.id) ?? null,
  }));
}
