import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

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

/** Tasks from this Member's current and historical Assignments, through RLS. */
export const TASK_PRESENTATION_FIELDS = `
  id, title, description, status, deadline, completed_at, review_round,
  dept_id, team_id, project_id, assignment_mode, audience, kind,
  parent_task_id, campaign_id, duplicated_from_task_id,
  department:departments!tasks_dept_id_fkey(name, color),
  team:teams!tasks_team_id_fkey(name, dept_id),
  project:projects!tasks_project_id_fkey(name),
  campaign:campaigns!tasks_campaign_id_fkey(name),
  assignments:task_assignments!task_assignments_task_id_fkey(id, member_id, ended_at),
  evaluations:task_evaluations!task_evaluations_task_id_fkey(id, difficulty, rating, points, reversed_at)
`;

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
    .eq('member_id', memberId);
  if (error) throw error;

  // A Member can have several Assignments on the same Task after rejoining.
  // Do not filter ended Assignments: evaluated work belongs in My tasks too.
  const tasks = new Map<number, TaskPresentationRow>();
  for (const row of data) {
    if (row.task) tasks.set(row.task.id, row.task);
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
  return [...tasks.values()].sort(byDeadlineThenTitle);
}

/** Tasks anyone may claim — the tracker's "Deschise" tab (#89). */
export function useOpenTasks() {
  return useQuery({
    queryKey: keys.tasks.open(),
    queryFn: fetchOpenTasks,
  });
}

export async function fetchOpenTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(`${TASK_FIELDS}, task_assignees(member_id)`)
    .eq('status', 'todo')
    .eq('assignment_mode', 'public')
    .eq('audience', 'org');
  if (error) throw error;
  return data
    .filter((task) => task.task_assignees.length === 0)
    .map(({ task_assignees: _assignments, ...task }) => task)
    .sort(byDeadlineThenTitle);
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
