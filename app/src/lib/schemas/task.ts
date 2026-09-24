import { z } from 'zod';
import { bucharestWallTimeToIso } from '../calendar-time';
import type {
  TaskDraft,
  TaskFormOptions,
} from '../../screens/tracker/task-form-model';
import {
  attachedLinkSchema,
  fieldForReason as linkFieldForReason,
} from './attached-link';
import { isId, optionalText, requiredText } from './text';

/**
 * A Task, as `create_task` / `update_task` accept it (#673, ruling R8): title
 * 3–120 characters, description at most 2000, a deadline not in the past on
 * creation, and the audience / assignment / Executor / Campaign combination
 * ADR-0007 allows. The command stays authoritative; this only means a draft
 * the server would refuse never leaves the browser.
 */
export const taskTitle = requiredText({
  required: 'title_required',
  min: 3,
  tooShort: 'title_too_short',
  max: 120,
  tooLong: 'title_too_long',
});
export const taskDescription = optionalText({
  max: 2000,
  tooLong: 'description_too_long',
});

/**
 * What the form hands the schema. `kind: 'subtask'` is the form's third
 * choice; a draft (`kind: 'task'` with a parent) is also accepted, so the same
 * schema re-checks a finished draft against a fresh options read.
 * `deadline` is an ISO instant, `null` for none, or `''` for a wall-clock time
 * that does not exist in Romania.
 */
export type TaskDraftInput = Omit<TaskDraft, 'kind' | 'link'> & {
  kind: TaskDraft['kind'] | 'subtask';
  /** The Attached Link as typed; blank means none (#684). */
  link: { label?: string | null; url?: string | null };
};

type When = {
  /** `create_task` refuses a deadline in the past; `update_task` accepts one. */
  creating?: boolean;
  now?: () => Date;
};

const instant = (value: string) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

function deadlineIssue(
  deadline: string | null,
  { creating = true, now = () => new Date() }: When,
): string | null {
  if (deadline === null) return null;
  const time = instant(deadline);
  if (time === null) return 'deadline_invalid';
  if (creating && time < now().getTime()) return 'deadline_in_past';
  return null;
}

/** Validate a new Task against a fresh, server-authorized options read. */
export function taskDraftSchema(options: TaskFormOptions, when: When = {}) {
  return z
    .object({
      title: taskTitle,
      description: taskDescription,
      deadline: z.string().nullable(),
      groupId: z.number(),
      kind: z.enum(['task', 'umbrella', 'subtask'], {
        error: 'invalid_task_kind',
      }),
      parentTaskId: z.number().nullable(),
      audience: z.enum(['local', 'org']).nullable(),
      assignmentMode: z.enum(['direct', 'public']).nullable(),
      executorId: z.string().nullable(),
      campaignId: z.number().nullable(),
      link: attachedLinkSchema,
    })
    .superRefine((draft, ctx) => {
      const issue = (path: keyof TaskDraft, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      const group = isId(draft.groupId)
        ? options.groups.find((candidate) => candidate.id === draft.groupId)
        : undefined;
      if (!isId(draft.groupId)) issue('groupId', 'task_group_required');
      else if (!group) issue('groupId', 'task_group_unavailable');

      const deadline = deadlineIssue(draft.deadline, when);
      if (deadline) issue('deadline', deadline);

      const umbrella = draft.kind === 'umbrella';
      if (draft.kind === 'subtask' && draft.parentTaskId === null)
        issue('parentTaskId', 'parent_unavailable');
      if (draft.parentTaskId !== null) {
        const parent = isId(draft.parentTaskId)
          ? options.umbrellas.find(
              (candidate) => candidate.id === draft.parentTaskId,
            )
          : undefined;
        if (umbrella) issue('kind', 'subtask_cannot_be_umbrella');
        else if (!parent) issue('parentTaskId', 'parent_unavailable');
        else if (group && parent.group_id !== group.id)
          issue('parentTaskId', 'subtask_origin_mismatch');
      }

      if (umbrella) {
        if (
          draft.audience !== null ||
          draft.assignmentMode !== null ||
          draft.executorId !== null ||
          draft.campaignId !== null
        )
          issue('kind', 'umbrella_has_no_mode');
        return;
      }
      if (draft.deadline === null) issue('deadline', 'deadline_required');
      if (draft.audience === null) issue('audience', 'invalid_audience');
      if (draft.assignmentMode === null)
        issue('assignmentMode', 'invalid_assignment_mode');
      if (draft.executorId !== null && !draft.executorId.trim())
        issue('executorId', 'invalid_executor');
      else if (draft.assignmentMode === 'public' && draft.executorId !== null)
        issue('executorId', 'executor_not_allowed_for_public');
      if (draft.campaignId !== null) {
        const campaign = options.campaigns.find(
          (candidate) => candidate.id === draft.campaignId,
        );
        if (!campaign || !group?.path.includes(campaign.group_id))
          issue('campaignId', 'invalid_campaign');
      }
    })
    .transform((draft): TaskDraft => ({
      ...draft,
      kind: draft.kind === 'umbrella' ? 'umbrella' : 'task',
    }));
}

/** The editable fields `update_task` replaces, all of them at once. */
export type TaskUpdateValues = {
  /** The Origin; a different one moves the Task (#627). */
  groupId: number;
  title: string;
  description: string | null;
  deadline: string | null;
  campaignId: number | null;
  assignmentMode: 'direct' | 'public' | null;
  audience: 'local' | 'org' | null;
  /** The Attached Link as typed; blank means none (#684). */
  link: { label?: string | null; url?: string | null };
};

/**
 * An edit (ADR-0007, amended 2026-09-21): the same text limits, a deadline an
 * ordinary Task cannot drop (a past one is allowed), a Campaign the Task may
 * carry — one offered for the chosen Group, or the one it already has — a
 * Group the caller manages (`groupIds`, when a fresh read is at hand) and an
 * Attached Link, both or neither.
 */
export function taskUpdateSchema({
  umbrella,
  campaignIds,
  groupIds,
}: {
  umbrella: boolean;
  campaignIds: readonly number[];
  groupIds?: readonly number[];
}) {
  return z
    .object({
      groupId: z.number(),
      title: taskTitle,
      description: taskDescription,
      deadline: z.string().nullable(),
      campaignId: z.number().nullable(),
      assignmentMode: z.enum(['direct', 'public']).nullable(),
      audience: z.enum(['local', 'org']).nullable(),
      link: attachedLinkSchema,
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof TaskUpdateValues, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (!isId(values.groupId)) issue('groupId', 'task_group_required');
      else if (groupIds && !groupIds.includes(values.groupId))
        issue('groupId', 'task_group_unavailable');
      const deadline = deadlineIssue(values.deadline, { creating: false });
      if (deadline) issue('deadline', deadline);
      if (umbrella) {
        if (values.campaignId !== null)
          issue('campaignId', 'umbrella_has_no_campaign');
        return;
      }
      if (values.deadline === null) issue('deadline', 'deadline_required');
      if (values.assignmentMode === null)
        issue('assignmentMode', 'invalid_assignment_mode');
      if (values.audience === null) issue('audience', 'invalid_audience');
      if (
        values.campaignId !== null &&
        !campaignIds.includes(values.campaignId)
      )
        issue('campaignId', 'invalid_campaign');
    });
}

/**
 * `duplicate_task`'s one field: the copy's deadline, a wall-clock time in
 * Romania that is not in the past. The parsed value is the ISO instant.
 */
export function taskDuplicateSchema(when: Omit<When, 'creating'> = {}) {
  return z.object({ deadline: z.string() }).transform((values, ctx) => {
    const iso = values.deadline
      ? (bucharestWallTimeToIso(values.deadline) ?? '')
      : null;
    const reason =
      iso === null
        ? 'deadline_required'
        : deadlineIssue(iso, { ...when, creating: true });
    if (iso === null || reason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['deadline'],
        message: reason ?? 'deadline_required',
      });
      return z.NEVER;
    }
    return { deadline: iso };
  });
}

/**
 * Where each reason a Task command (or these schemas) raises is shown: the
 * create form, the edit form and the duplicate dialog share it. The Attached
 * Link's reasons land under `link.label` / `link.url`, the names
 * `AttachedLinkFields` gets with `name="link"`.
 */
export const fieldForReason: Readonly<Record<string, string>> = {
  title_required: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  description_too_long: 'description',
  deadline_required: 'deadline',
  deadline_in_past: 'deadline',
  deadline_invalid: 'deadline',
  task_group_required: 'groupId',
  task_group_unavailable: 'groupId',
  // #627: moving a Task to another Group.
  invalid_group: 'groupId',
  subtask_origin_immutable: 'groupId',
  umbrella_has_subtasks: 'groupId',
  invalid_task_kind: 'kind',
  subtask_cannot_be_umbrella: 'kind',
  umbrella_has_no_mode: 'kind',
  parent_not_umbrella: 'parentTaskId',
  parent_terminal: 'parentTaskId',
  parent_unavailable: 'parentTaskId',
  subtask_origin_mismatch: 'parentTaskId',
  invalid_audience: 'audience',
  invalid_assignment_mode: 'assignmentMode',
  invalid_executor: 'executorId',
  executor_not_allowed_for_public: 'executorId',
  invalid_campaign: 'campaignId',
  umbrella_has_no_campaign: 'campaignId',
  ...Object.fromEntries(
    Object.entries(linkFieldForReason).map(([reason, field]) => [
      reason,
      `link.${field}`,
    ]),
  ),
  // The server's one both-or-neither reason (#684); the browser says which
  // half is missing, so this only arrives from a caller that skipped it.
  link_incomplete: 'link.url',
};
