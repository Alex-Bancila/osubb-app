import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { latestSubmissionOnly, TASK_PRESENTATION_FIELDS } from './tasks';
import { attachVisibleTaskExecutors } from './task-executors';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

export type TaskDetailsData = {
  task: TaskPresentationRow;
  executorName: string | null;
  subtasks: TaskPresentationRow[];
};
export async function fetchTaskDetails(
  taskId: number,
): Promise<TaskDetailsData | null> {
  const { data, error } = await latestSubmissionOnly(
    supabase.from('tasks').select(TASK_PRESENTATION_FIELDS),
  )
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const task: TaskPresentationRow = data;
  let subtasks: TaskDetailsData['subtasks'] = [];
  if (task.parent_task_id !== null) {
    const parent = await supabase
      .from('tasks')
      .select('title')
      .eq('id', task.parent_task_id)
      .maybeSingle();
    if (parent.error) throw parent.error;
    task.parent = parent.data;
  }
  if (task.kind === 'umbrella') {
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const children = await latestSubmissionOnly(
        supabase.from('tasks').select(TASK_PRESENTATION_FIELDS),
      )
        .eq('parent_task_id', taskId)
        .order('id')
        .range(offset, offset + pageSize - 1);
      if (children.error) throw children.error;
      subtasks.push(...(await attachVisibleTaskExecutors(children.data)));
      if (children.data.length < pageSize) break;
    }
    task.subtasks = subtasks;
  }
  const [taskWithExecutor] = await attachVisibleTaskExecutors([task]);
  if (!taskWithExecutor)
    throw new Error('Task Executor enrichment returned no Task.');
  return {
    task: taskWithExecutor,
    executorName:
      taskWithExecutor.visibleExecutor?.nickname ??
      taskWithExecutor.visibleExecutor?.fullName ??
      null,
    subtasks,
  };
}
export function useTaskDetails(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.detail(taskId, memberId),
    queryFn: memberId ? () => fetchTaskDetails(taskId) : skipToken,
  });
}
