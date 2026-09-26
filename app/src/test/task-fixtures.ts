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
      is_organization: false,
    },
    assignments: [{ id: 1, member_id: 'member', ended_at: null }],
    ...overrides,
  };
}

/**
 * What `latestSubmissionOnly` chains right after `select` — `eq`, `order`,
 * `limit` on the `submission` embed — before handing back `next`, the rest
 * of the query a test mocks. `calls` records the embed filter it received.
 */
export function afterSubmissionFilter<T>(next: T) {
  const calls: unknown[][] = [];
  return {
    calls,
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args]);
      return {
        order: (...orderArgs: unknown[]) => {
          calls.push(['order', ...orderArgs]);
          return {
            limit: (...limitArgs: unknown[]) => {
              calls.push(['limit', ...limitArgs]);
              return next;
            },
          };
        },
      };
    },
  };
}
