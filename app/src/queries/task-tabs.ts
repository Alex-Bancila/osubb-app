import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { TASK_PRESENTATION_FIELDS } from './tasks';
import { attachVisibleTaskExecutors } from './task-executors';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

export async function fetchManagedTasks(): Promise<TaskPresentationRow[]> {
  const data: { task_id: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await supabase
      .rpc('my_managed_task_ids')
      .range(offset, offset + 499);
    if (page.error) throw page.error;
    data.push(...page.data);
    if (page.data.length < 500) break;
  }
  if (!data.length) return [];
  const rows: TaskPresentationRow[] = [];
  for (let offset = 0; offset < data.length; offset += 100) {
    const result = await supabase
      .from('tasks')
      .select(TASK_PRESENTATION_FIELDS)
      .in(
        'id',
        data.slice(offset, offset + 100).map((item) => item.task_id),
      );
    if (result.error) throw result.error;
    rows.push(...result.data);
  }
  return attachVisibleTaskExecutors(rows);
}
export function useTaskManagement() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.management(memberId),
    queryFn: memberId
      ? async () => {
          const { data, error } = await supabase.rpc('can_manage_tasks');
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
export async function fetchTaskLeadership() {
  const { data, error } = await supabase.rpc('can_read_all_tasks');
  if (error) throw error;
  return data;
}
export function useTaskLeadership() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.leadershipCapability(memberId),
    queryFn: memberId ? fetchTaskLeadership : skipToken,
  });
}
export function useManagedTasks(enabled: boolean) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.managed(memberId),
    queryFn: memberId && enabled ? fetchManagedTasks : skipToken,
  });
}
export function useAllTasks(enabled: boolean) {
  const session = useAuth().session;
  return useQuery({
    queryKey: keys.tasks.leadership(session?.user.id),
    queryFn:
      session && enabled
        ? async (): Promise<TaskPresentationRow[]> => {
            const rows: TaskPresentationRow[] = [];
            for (let offset = 0; ; offset += 500) {
              const { data, error } = await supabase
                .from('tasks')
                .select(TASK_PRESENTATION_FIELDS)
                .order('id')
                .range(offset, offset + 499);
              if (error) throw error;
              rows.push(...data);
              if (data.length < 500) return attachVisibleTaskExecutors(rows);
            }
          }
        : skipToken,
  });
}
