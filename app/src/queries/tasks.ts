import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import { attachVisibleTaskExecutors } from './task-executors';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/** Tasks from this Member's current and historical Assignments, through RLS. */
export const TASK_PRESENTATION_FIELDS = `
  id, title, description, status, deadline, completed_at, review_round,
  dept_id, team_id, project_id, assignment_mode, audience, kind,
  parent_task_id, campaign_id, duplicated_from_task_id, queue_closed_at,
  department:departments!tasks_dept_id_fkey(name, color),
  team:teams!tasks_team_id_fkey(name, dept_id),
  project:projects!tasks_project_id_fkey(name),
  campaign:campaigns!tasks_campaign_id_fkey(name),
  assignments:task_assignments!task_assignments_task_id_fkey(id, member_id, ended_at),
  evaluations:task_evaluations!task_evaluations_task_id_fkey(id, difficulty, rating, points, reversed_at)
`;

/**
 * Every Task I have ever been the Executor of — in progress and decided
 * alike. Points come from completed work (ADR-0007: an ordinary member's own
 * points are exactly the sum of their Evaluations), so a "my tasks" view
 * that stopped showing a Task the moment it was finished would hide the very
 * thing it exists to show. `completed`, `unfulfilled` and `cancelled` Tasks
 * stay in this list; #164's presentation model is what gives them their tab.
 *
 * Asked from `task_assignments` inwards rather than from `tasks` outwards,
 * because "assigned to me" is a fact about the Assignment row. PostgREST
 * embeds the task and its authorized relations through the foreign keys, so
 * this is one request, not one plus N.
 *
 * A reopened Task produces two Assignment rows for the same member — Task
 * History is append-only, so nothing ever deletes the first one — and both
 * would otherwise render as separate list items and collide on
 * `key={task.id}`. The fix is structural, not a filter that hides finished
 * work: order by `assigned_at, id` descending and keep only the *first* row
 * seen for each Task id, i.e. its most recent Assignment. One row per Task id
 * is then true by construction, and *which* Assignment represents the Task is
 * deterministic rather than whichever row the server happened to return last.
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

export async function fetchMyTasks(
  memberId: string,
): Promise<TaskPresentationRow[]> {
  const { data, error } = await supabase
    .from('task_assignments')
    .select(
      `task:tasks!task_assignments_task_id_fkey(${TASK_PRESENTATION_FIELDS})`,
    )
    .eq('member_id', memberId)
    .order('assigned_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;

  // A Member can have several Assignments on the same Task after a reopen or a
  // rejoin. Ordered newest-first above, so the FIRST row seen for a Task id is
  // its most recent Assignment — keep that one. Never filter ended
  // Assignments: evaluated work belongs in My tasks too.
  const tasks = new Map<number, TaskPresentationRow>();
  for (const row of data) {
    if (row.task && !tasks.has(row.task.id)) tasks.set(row.task.id, row.task);
  }
  // Fetch parent titles in one batch. Keep them behind their own Task RLS;
  // the self-referencing embed is ambiguous to the generated client types.
  const parentIds = [
    ...new Set(
      [...tasks.values()].flatMap((task) =>
        task.parent_task_id === null ? [] : [task.parent_task_id],
      ),
    ),
  ];
  if (parentIds.length) {
    const { data: parents, error: parentError } = await supabase
      .from('tasks')
      .select('id, title')
      .in('id', parentIds);
    if (parentError) throw parentError;
    const titles = new Map(parents.map((parent) => [parent.id, parent]));
    for (const task of tasks.values()) {
      if (task.parent_task_id !== null)
        task.parent = titles.get(task.parent_task_id) ?? null;
    }
  }
  return attachVisibleTaskExecutors(
    [...tasks.values()].sort(byDeadlineThenTitle),
  );
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
    const difference = Date.parse(a.deadline) - Date.parse(b.deadline);
    if (difference) return difference;
  }
  return a.title.localeCompare(b.title, 'ro');
}
