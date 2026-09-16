import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type TaskActivity =
  Database['public']['Tables']['task_activity']['Row'] & {
    actorName: string | null;
  };
export async function fetchTaskHistory(
  taskId: number,
): Promise<TaskActivity[]> {
  const rows: Database['public']['Tables']['task_activity']['Row'][] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('task_activity')
      .select(
        'id, task_id, actor_id, assignment_id, kind, note, occurred_at, created_at, from_status, to_status, details',
      )
      .eq('task_id', taskId)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  const ids = [
    ...new Set(rows.flatMap((row) => (row.actor_id ? [row.actor_id] : []))),
  ];
  const names = new Map<string, string | null>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from('profiles_directory')
      .select('id, full_name')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    for (const member of data)
      if (member.id) names.set(member.id, member.full_name);
  }
  return rows.map((row) => ({
    ...row,
    actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
  }));
}
export function useTaskHistory(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.history(taskId, memberId),
    queryFn: memberId ? () => fetchTaskHistory(taskId) : skipToken,
  });
}
