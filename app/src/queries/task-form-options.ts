import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { fetchCampaigns } from './campaigns';
import type { TaskFormOptions } from '../screens/tracker/task-form-model';

async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await read(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export async function fetchTaskFormOptions(): Promise<TaskFormOptions> {
  const groups = await pages((from, to) =>
    supabase
      .rpc('managed_work_groups')
      .order('path')
      .order('id')
      .range(from, to),
  );
  if (!groups.length) return { groups: [], campaigns: [], umbrellas: [] };
  const [campaigns, umbrellas, groupNames] = await Promise.all([
    fetchCampaigns().then((rows) =>
      rows.filter((campaign) => campaign.is_active),
    ),
    pages((from, to) =>
      supabase
        .from('tasks')
        .select('id,title,group_id')
        .eq('kind', 'umbrella')
        .in('status', ['todo', 'in_progress', 'in_review'])
        .order('id')
        .range(from, to),
    ),
    // Readable Group names, so a managed Child Group is shown with its parent,
    // and which of them are private (#757): their Tasks are local only.
    pages((from, to) =>
      supabase
        .from('groups')
        .select('id,name,is_private')
        .order('id')
        .range(from, to),
    ),
  ]);
  const ids = new Set(groups.map((group) => group.id));
  return {
    groups,
    campaigns,
    umbrellas: umbrellas.filter((parent) => ids.has(parent.group_id)),
    groupNames,
  };
}
export function useTaskFormOptions() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.formOptions(memberId),
    queryFn: memberId ? fetchTaskFormOptions : skipToken,
  });
}
