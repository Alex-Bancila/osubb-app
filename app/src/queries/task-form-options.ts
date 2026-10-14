import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { readAllRows } from './read-all';
import { fetchCampaigns } from './campaigns';
import type { TaskFormOptions } from '../screens/tracker/task-form-model';

export async function fetchTaskFormOptions(): Promise<TaskFormOptions> {
  const groups = await readAllRows((from, to) =>
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
    readAllRows((from, to) =>
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
    readAllRows((from, to) =>
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
