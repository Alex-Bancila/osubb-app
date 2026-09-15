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
 * The tasks I am currently the Executor of.
 *
 * Asked from `task_assignments` inwards rather than from `tasks` outwards,
 * because "assigned to me" is a fact about the Assignment row. PostgREST
 * embeds the task through the foreign key, so this is one request, not one
 * plus N. `ended_at is null` is what makes it *current*: Assignment History
 * keeps every past Assignment too, and a Task someone gave up or finished is
 * no longer theirs to do (ADR-0007, one Executor at a time).
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

async function fetchMyTasks(memberId: string) {
  const { data, error } = await supabase
    .from('task_assignments')
    .select(`task:tasks(${TASK_FIELDS})`)
    .eq('member_id', memberId)
    .is('ended_at', null);
  if (error) throw error;

  return data
    .map((row) => row.task)
    .filter((task) => task !== null)
    .sort(byDeadlineThenTitle);
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
