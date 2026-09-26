import type { Json } from '../../lib/database.types';
import { chosenGroupId, type WorkFilterValue } from '../../lib/work-filter';
import type { MemberTask } from '../../queries/leadership';
import {
  toTaskPresentation,
  type TaskPresentation,
  type TaskPresentationRow,
} from '../tracker/task-presentation';

/** The part of a Group the Member tracker reads from the filter options. */
export type HistoryGroup = {
  id: number;
  name: string;
  path: readonly number[];
  color: string | null;
  category: string;
  is_organization: boolean;
};

/** One Evaluation of an Assignment, as `leadership_member_tasks` returns it. */
export type HistoryEvaluation = {
  id: number;
  outcome: 'completed' | 'unfulfilled';
  points: number | null;
  difficulty: number | null;
  rating: number | null;
  note: string | null;
  evaluatedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
};

/** One Subtask of an Umbrella Task in the history. */
export type HistorySubtask = {
  id: number;
  title: string;
  status: string;
  completedLate: boolean;
};

function objects(value: Json | undefined) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is { [key: string]: Json | undefined } =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
const numberOr = (value: Json | undefined) =>
  typeof value === 'number' ? value : null;
const textOr = (value: Json | undefined) =>
  typeof value === 'string' && value.trim() ? value : null;

export function historyEvaluations(value: Json): HistoryEvaluation[] {
  return objects(value).map((entry, index) => ({
    id: numberOr(entry.id) ?? -index - 1,
    outcome: entry.outcome === 'completed' ? 'completed' : 'unfulfilled',
    points: numberOr(entry.points),
    difficulty: numberOr(entry.difficulty),
    rating: numberOr(entry.rating),
    note: textOr(entry.note),
    evaluatedAt: textOr(entry.evaluated_at),
    reversedAt: textOr(entry.reversed_at),
    reversalReason: textOr(entry.reversal_reason),
  }));
}

export function historySubtasks(value: Json): HistorySubtask[] {
  return objects(value).map((child, index) => ({
    id: numberOr(child.id) ?? -index - 1,
    title: textOr(child.title) ?? 'Subtask',
    status: typeof child.status === 'string' ? child.status : '',
    completedLate: child.completed_late === true,
  }));
}

/**
 * One Assignment as the rebuilt Task card (#685) draws it. The row carries the
 * owning Group's id and name; its colour and noun come from the filter's Group
 * read. The points line is the Assignment's standing Evaluation — a reversed
 * one no longer counts — and every Evaluation stays listed underneath.
 */
export function memberTaskPresentation(
  row: MemberTask,
  groupsById: ReadonlyMap<number, HistoryGroup>,
  now: Date,
): TaskPresentation {
  const group = groupsById.get(row.group_id);
  const name = row.group_name?.trim() || group?.name;
  const presentationRow: TaskPresentationRow = {
    id: row.task_id,
    title: row.title ?? '',
    description: row.description,
    status: row.status,
    deadline: row.deadline,
    completed_at: row.completed_at,
    review_round: row.review_round ?? 0,
    group_id: row.group_id,
    assignment_mode: row.assignment_mode,
    audience: row.audience,
    kind: row.task_kind,
    parent_task_id: row.parent_task_id,
    campaign_id: row.campaign_id,
    duplicated_from_task_id: row.duplicated_from_task_id,
    queue_closed_at: row.queue_closed_at,
    link_label: null,
    link_url: null,
    group: name
      ? {
          name,
          short: '',
          color: group?.color ?? null,
          category: group?.category ?? '',
          path: [...(group?.path ?? [row.group_id])],
          is_organization: group?.is_organization ?? false,
        }
      : null,
    campaign: row.campaign_name ? { name: row.campaign_name } : null,
    parent: row.parent_task_title ? { title: row.parent_task_title } : null,
    visibleExecutor: null,
    // An entry missing a score is not an Evaluation the card can summarise;
    // it stays in the full list underneath.
    evaluations: historyEvaluations(row.evaluation_history).flatMap((entry) =>
      entry.points !== null &&
      entry.difficulty !== null &&
      entry.rating !== null
        ? [
            {
              id: entry.id,
              difficulty: entry.difficulty,
              rating: entry.rating,
              points: entry.points,
              reversed_at: entry.reversedAt,
            },
          ]
        : [],
    ),
  };
  const task = toTaskPresentation(presentationRow, now);
  // The server knows lateness from the Task's own clock; trust it over ours.
  return {
    ...task,
    overdue: row.is_overdue ?? task.overdue,
    completedLate: row.completed_late ?? task.completedLate,
  };
}

/**
 * The Group and Campaign levels of the Member tracker's Work Filter, applied
 * to the rows the server already narrowed by deadline (#677). A Group means
 * that Group and every Group below it; a row whose Group the viewer cannot
 * place in the tree never matches a Group filter.
 */
export function filterMemberTasks(
  rows: readonly MemberTask[],
  value: WorkFilterValue,
  groupsById: ReadonlyMap<number, HistoryGroup>,
): MemberTask[] {
  const groupId = chosenGroupId(value);
  return rows.filter(
    (row) =>
      (groupId === undefined ||
        (groupsById.get(row.group_id)?.path.includes(groupId) ?? false)) &&
      (value.campaignId === undefined || row.campaign_id === value.campaignId),
  );
}
