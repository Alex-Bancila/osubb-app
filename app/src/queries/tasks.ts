import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

/* The columns a task list needs. Named once so the row type stays identical
   everywhere and adding a column is one edit, not a hunt.

   No `points`: #317 moved a Task's points onto the Evaluation that awarded
   them (`task_evaluations`), so `tasks` no longer carries the column at all.
   A member's own Evaluation becomes readable in the rebuilt Tracker (#164,
   #346-#354); until then this list shows the Difficulty and Rating the Task
   itself still records, rather than recomputing the scoring guide in
   TypeScript — a second copy of that formula would disagree with the ledger
   the moment the guide changes or an Evaluation is reversed. */
const TASK_FIELDS =
  'id, title, status, type, difficulty, rating, deadline, dept_id, team_id';

/**
 * Every Task I have ever been the Executor of — in progress and decided
 * alike. Points come from completed work (ADR-0007: an ordinary member's own
 * points are exactly the sum of their Evaluations), so a "my tasks" view
 * that stopped showing a Task the moment it was finished would hide the very
 * thing it exists to show. `completed`, `unfulfilled` and `cancelled` Tasks
 * stay in this list; the Tracker rebuild (#164, #346-#354) is what will give
 * them their own tab.
 *
 * Asked from `task_assignments` inwards rather than from `tasks` outwards,
 * because "assigned to me" is a fact about the Assignment row. PostgREST
 * embeds the task through the foreign key, so this is one request, not one
 * plus N.
 *
 * A reopened Task produces two Assignment rows for the same member — Task
 * History is append-only, so nothing ever deletes the first one — and both
 * would otherwise render as separate list items and collide on
 * `key={task.id}`. The fix is structural, not a filter that hides finished
 * work: order by `assigned_at, id` descending and keep only the first row
 * seen for each Task id, i.e. its most recent Assignment. One row per Task
 * id is then true by construction, not by excluding whichever rows happen to
 * be terminal.
 *
 * #345 retired the multi-assignee join table this used to read; the read
 * policy on `task_assignments` already admits a member their own rows.
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

export async function fetchMyTasks(memberId: string) {
  const { data, error } = await supabase
    .from('task_assignments')
    .select(`task:tasks(${TASK_FIELDS})`)
    .eq('member_id', memberId)
    .order('assigned_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;

  const byTaskId = new Map<
    number,
    NonNullable<(typeof data)[number]['task']>
  >();
  for (const row of data) {
    if (row.task !== null && !byTaskId.has(row.task.id)) {
      byTaskId.set(row.task.id, row.task);
    }
  }

  return [...byTaskId.values()].sort(byDeadlineThenTitle);
}

/** Tasks anyone may put themselves forward for — the tracker's "Deschise" tab (#89).
 *
 * "Open" used to mean "a public todo Task with no row in the legacy
 * multi-assignee join table". #345 retired that table, and the normalized
 * model states the same thing directly on the Task: an opportunity is a
 * public Task whose Candidate Queue is still open (`queue_opened_at` set,
 * `queue_closed_at` null) — exactly the R6 branch of the `tasks_read` policy.
 * RLS decides whether an org or local opportunity is eligible for this
 * caller, and an Executor does not end the opportunity: members may still
 * join its Queue while work is in progress.
 * That is deliberately not "has no Executor" measured through
 * `task_assignments`: its read policy shows a member only their OWN
 * Assignment rows, so an embed there would report every Task somebody else
 * had already taken as still free. The Queue is the honest signal, and it is
 * the one the Tracker rebuild (#164, #346-#354) will keep using. */
export function useOpenTasks() {
  return useQuery({
    queryKey: keys.tasks.open(),
    queryFn: fetchOpenTasks,
  });
}

export async function fetchOpenTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_FIELDS)
    .eq('assignment_mode', 'public')
    .not('queue_opened_at', 'is', null)
    .is('queue_closed_at', null);
  if (error) throw error;
  return data.sort(byDeadlineThenTitle);
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
