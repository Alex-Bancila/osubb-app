/**
 * Taskurile mele's open Tasks (ruling R55) read through the list reader in
 * `task-lists.ts`; Acasă and the Tracker import them from here, as before (the
 * Calendar month reads `useMyTasksInRange` there).
 */
export { useMyTasks } from './task-lists';

/**
 * A Task as a card reads it, through RLS, from a PostgREST read of `tasks`
 * (the details sheet's): its fields, Group, Campaign, Assignment History,
 * Evaluations and Submission Note. The Tracker's lists read the same through
 * `task_list`.
 */
export const TASK_PRESENTATION_FIELDS = `
  id, group_id, title, description, status, deadline, completed_at, review_round,
  assignment_mode, audience, kind,
  parent_task_id, campaign_id, duplicated_from_task_id, queue_closed_at,
  links,
  group:groups!tasks_group_id_fkey(name, short, color, category, path, is_organization, is_private),
  campaign:campaigns!tasks_campaign_id_fkey(name),
  assignments:task_assignments!task_assignments_task_id_fkey(id, member_id, ended_at),
  evaluations:task_evaluations!task_evaluations_task_id_fkey(id, difficulty, rating, points, reversed_at),
  submission:task_activity!task_activity_task_id_fkey(id, kind, note, details, occurred_at)
`;

/** A query builder that can filter, order and limit an embedded resource. */
type EmbedFilterable<Q> = {
  eq(column: string, value: string): Q;
  order(
    column: string,
    options: { ascending: boolean; referencedTable: string },
  ): Q;
  limit(count: number, options: { referencedTable: string }): Q;
};

/**
 * Narrows `TASK_PRESENTATION_FIELDS`' `submission` embed to the latest
 * `submitted` history row (#685): kind `submitted`, newest id first, one row.
 * Every query selecting those fields applies it right after `select`, so a
 * read gets each card's Submission Note in the same request, through
 * `task_activity`'s own RLS. `path` is the embed's dotted path when the Tasks
 * are themselves embedded (`task.submission` from `task_assignments`).
 */
export function latestSubmissionOnly<Q extends EmbedFilterable<Q>>(
  query: Q,
  path = 'submission',
): Q {
  return query
    .eq(`${path}.kind`, 'submitted')
    .order('id', { ascending: false, referencedTable: path })
    .limit(1, { referencedTable: path });
}
