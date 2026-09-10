import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

/* The columns a task list needs. Named once so the row type stays identical
   everywhere and adding a column is one edit, not a hunt. */
const TASK_FIELDS =
  'id, title, status, type, difficulty, rating, points, deadline, dept_id, team_id';

/**
 * The tasks I am assigned to.
 *
 * Asked from `task_assignees` inwards rather than from `tasks` outwards,
 * because "assigned to me" is a fact about the join row. PostgREST embeds the
 * task through the foreign key, so this is one request, not one plus N.
 *
 * Note what is *not* here: no filter on department, team or role. RLS already
 * returned exactly the tasks this member may see — filtering again in
 * TypeScript would be a second, weaker copy of a rule that already exists
 * (mini-spec §1).
 */
export function useMyTasks() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.tasks.mine(id),
    queryFn: id ? () => fetchMyTasks(id) : skipToken,
  });
}

async function fetchMyTasks(memberId: string) {
  const { data, error } = await supabase
    .from('task_assignees')
    .select(`task:tasks(${TASK_FIELDS})`)
    .eq('member_id', memberId);
  if (error) throw error;

  return data
    .map((row) => row.task)
    .filter((task) => task !== null)
    .sort(byDeadlineThenTitle);
}

/** Tasks anyone may claim — the tracker's "Deschise" tab (#89). */
export function useOpenTasks() {
  return useQuery({
    queryKey: keys.tasks.open(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_FIELDS)
        .eq('status', 'open');
      if (error) throw error;
      return data.sort(byDeadlineThenTitle);
    },
  });
}

/* Soonest deadline first, undated last — a list of work should open on what is
   most urgent. Title breaks the tie so the order never wobbles between renders. */
function byDeadlineThenTitle(
  a: { deadline: string | null; title: string },
  b: { deadline: string | null; title: string },
) {
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  return a.title.localeCompare(b.title, 'ro');
}
