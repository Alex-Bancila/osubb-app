import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

export function taskRow(
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return {
    id: 1,
    title: 'Pregătește materialele',
    description: null,
    status: 'todo',
    deadline: '2026-09-16T10:00:00Z',
    completed_at: null,
    review_round: 0,
    dept_id: 'edu',
    team_id: null,
    project_id: null,
    assignment_mode: 'direct',
    audience: 'local',
    kind: 'task',
    parent_task_id: null,
    campaign_id: null,
    duplicated_from_task_id: null,
    queue_closed_at: null,
    department: { name: 'Educațional', color: 'var(--dept-edu)' },
    assignments: [{ id: 1, member_id: 'member', ended_at: null }],
    ...overrides,
  };
}
