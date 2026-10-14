import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useCapability } from '../lib/capabilities';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * The two leadership Task lists read their open Tasks through `task_list`
 * (#1053, `task-lists.ts`); every reader of the managed list imports them
 * from here, as before.
 */
export { useAllTasks, useManagedTasks } from './task-lists';

/**
 * `manage_tasks` from the one capability row (`my_capabilities()`, which is
 * exactly `can_manage_tasks()`), so the Tracker, the nav and the Campaigns
 * guard share one cached request instead of each asking the server.
 */
export function useTaskManagement() {
  return useCapability('manageTasks');
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
