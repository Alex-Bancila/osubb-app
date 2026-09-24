import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

export function taskRow(
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return {
    id: 1,
    group_id: 1,
    title: 'Pregătește materialele',
    description: null,
    status: 'todo',
    deadline: '2026-09-16T10:00:00Z',
    completed_at: null,
    review_round: 0,
    assignment_mode: 'direct',
    audience: 'local',
    kind: 'task',
    parent_task_id: null,
    campaign_id: null,
    duplicated_from_task_id: null,
    queue_closed_at: null,
    link_label: null,
    link_url: null,
    group: {
      name: 'Educațional',
      short: 'EDU',
      color: 'var(--dept-edu)',
      category: 'department',
      path: [1],
    },
    assignments: [{ id: 1, member_id: 'member', ended_at: null }],
    ...overrides,
  };
}
