import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { TASK_PRESENTATION_FIELDS } from './tasks';
import { attachVisibleTaskExecutors } from './task-executors';
import type {
  TaskPresentationRow,
  TaskStatus,
} from '../screens/tracker/task-presentation';

export type TaskDetailsData = {
  task: TaskPresentationRow;
  executorName: string | null;
  subtasks: { id: number; title: string; status: TaskStatus }[];
};
export async function fetchTaskDetails(
  taskId: number,
): Promise<TaskDetailsData | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_PRESENTATION_FIELDS)
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
    const children = await supabase
      .from('tasks')
      .select('id, title, status')
      .eq('parent_task_id', taskId)
      .order('id');
    if (children.error) throw children.error;
    subtasks = children.data;
    task.subtasks = subtasks;
  }
  const [taskWithExecutor] = await attachVisibleTaskExecutors([task]);
  if (!taskWithExecutor)
    throw new Error('Task Executor enrichment returned no Task.');
  return {
    task: taskWithExecutor,
    executorName: taskWithExecutor.visibleExecutor?.fullName ?? null,
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
