import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { TASK_PRESENTATION_FIELDS } from './tasks';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

export type TaskMemberships = {
  departments: string[];
  teams: string[];
  projects: number[];
};

export async function fetchTaskMemberships(
  memberId: string,
): Promise<TaskMemberships> {
  const [departments, teams, projects] = await Promise.all([
    supabase
      .from('member_departments')
      .select('dept_id')
      .eq('member_id', memberId),
    supabase.from('team_members').select('team_id').eq('member_id', memberId),
    supabase
      .from('project_members')
      .select('project_id')
      .eq('member_id', memberId),
  ]);
  for (const result of [departments, teams, projects])
    if (result.error) throw result.error;
  return {
    departments: (departments.data ?? []).map((row) => row.dept_id),
    teams: (teams.data ?? []).map((row) => row.team_id),
    projects: (projects.data ?? []).map((row) => row.project_id),
  };
}

export function hasOwnOrigin(
  task: TaskPresentationRow,
  scopes: TaskMemberships,
): boolean {
  if (task.team_id !== null) return scopes.teams.includes(task.team_id);
  if (task.project_id !== null)
    return scopes.projects.includes(task.project_id);
  return task.dept_id !== null && scopes.departments.includes(task.dept_id);
}

export function orderOpportunities(
  rows: TaskPresentationRow[],
  scopes: TaskMemberships,
  participatedTaskIds: ReadonlySet<number> = new Set(),
): TaskPresentationRow[] {
  // Managers may read local Tasks outside their memberships; those are not
  // Opportunities they can join. This narrows the already-authorized rows.
  return rows
    .filter(
      (task) =>
        participatedTaskIds.has(task.id) ||
        task.audience === 'org' ||
        hasOwnOrigin(task, scopes),
    )
    .sort(
      (a, b) =>
        Number(hasOwnOrigin(b, scopes)) - Number(hasOwnOrigin(a, scopes)) ||
        (a.deadline ? Date.parse(a.deadline) : Infinity) -
          (b.deadline ? Date.parse(b.deadline) : Infinity) ||
        a.title.localeCompare(b.title, 'ro') ||
        a.id - b.id,
    );
}

export async function fetchTaskOpportunities(
  memberId: string,
): Promise<TaskPresentationRow[]> {
  const [scopes, candidatures] = await Promise.all([
    fetchTaskMemberships(memberId),
    supabase
      .from('task_candidates')
      .select('task_id')
      .eq('member_id', memberId),
  ]);
  if (candidatures.error) throw candidatures.error;

  const participatedTaskIds = new Set(
    (candidatures.data ?? []).map((candidate) => candidate.task_id),
  );
  const openTasks = supabase
    .from('tasks')
    .select(TASK_PRESENTATION_FIELDS)
    .eq('kind', 'task')
    .eq('assignment_mode', 'public')
    .is('queue_closed_at', null)
    .in('status', ['todo', 'in_progress', 'in_review']);
  const openResult = await openTasks;
  if (openResult.error) throw openResult.error;
  const participatedTasks: TaskPresentationRow[] = [];
  const participatedIds = [...participatedTaskIds];
  for (let offset = 0; offset < participatedIds.length; offset += 100) {
    const result = await supabase
      .from('tasks')
      .select(TASK_PRESENTATION_FIELDS)
      .eq('kind', 'task')
      .eq('assignment_mode', 'public')
      .in('id', participatedIds.slice(offset, offset + 100));
    if (result.error) throw result.error;
    participatedTasks.push(...result.data);
  }

  // The server remains authoritative for both sets. The second query retains
  // an existing participant's state after the queue or Task becomes terminal.
  const tasks = new Map<number, TaskPresentationRow>();
  for (const task of [...openResult.data, ...participatedTasks])
    tasks.set(task.id, task);
  return orderOpportunities([...tasks.values()], scopes, participatedTaskIds);
}

export function useTaskOpportunities() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.available(memberId),
    queryFn: memberId ? () => fetchTaskOpportunities(memberId) : skipToken,
  });
}
