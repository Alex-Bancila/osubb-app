import { z } from 'zod';
import {
  attachedLinksSchema,
  linksFieldForReason,
  type AttachedLink,
} from './attached-link';
import {
  evaluationShape,
  fieldForReason as evaluationFields,
} from './evaluation';
import { taskDescription, taskTitle } from './task';
import { isId } from './text';

/**
 * A completed Task (#915), as `approve_completed_work_request` (shaping a
 * Request's Task) and `create_completed_task` (adding one directly) accept
 * it: the Task's title, details, Group, Attached Links (up to five, R46) and Campaign — no
 * deadline, no Audience — then the Evaluation's Difficulty, Rating and note.
 * The commands stay authoritative; this keeps a draft they would refuse in
 * the browser.
 */
export type CompletedTaskInput = {
  title: string;
  description: string;
  groupId: number | null;
  /** The volunteer; always set when approving (the requester). */
  executorId: string | null;
  /** The rows as typed; a blank row is dropped (R46). */
  links: AttachedLink[];
  campaignId: number | null;
  difficulty: string;
  rating: string;
  note: string;
};

export function completedTaskSchema({
  groupIds,
  campaigns,
}: {
  /** The Groups the form offers; any other is no longer available. */
  groupIds: readonly number[];
  /** The Campaigns each offered Group may carry. */
  campaigns: (groupId: number) => readonly number[];
}) {
  return z
    .object({
      title: taskTitle,
      description: taskDescription,
      // Field-level, so a missing Group or volunteer shows on the first try
      // beside every other broken field (an object refinement waits for the
      // fields to pass).
      groupId: z
        .number()
        .nullable()
        .superRefine((groupId, ctx) => {
          if (!isId(groupId))
            ctx.addIssue({ code: 'custom', message: 'task_group_required' });
          else if (!groupIds.includes(groupId))
            ctx.addIssue({ code: 'custom', message: 'task_group_unavailable' });
        }),
      executorId: z
        .string()
        .nullable()
        .superRefine((executorId, ctx) => {
          if (!executorId?.trim())
            ctx.addIssue({ code: 'custom', message: 'executor_required' });
        }),
      links: attachedLinksSchema,
      campaignId: z.number().nullable(),
      ...evaluationShape,
    })
    .superRefine((values, ctx) => {
      if (
        values.campaignId !== null &&
        (!isId(values.groupId) ||
          !campaigns(values.groupId).includes(values.campaignId))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['campaignId'],
          message: 'invalid_campaign',
        });
    });
}

export type CompletedTaskValues = z.output<
  ReturnType<typeof completedTaskSchema>
>;

/** The reasons about the volunteer: under Voluntar, or under Grup when the volunteer is fixed. */
const EXECUTOR_REASONS = [
  'executor_required',
  'invalid_executor',
  'executor_not_group_member',
  'executor_below_min_level',
  'executor_role_excluded',
] as const;

/**
 * Where each reason is shown. When the volunteer is fixed (an approval, or
 * Trackerul membrului), a refusal about them is a refusal of the Group chosen
 * for them, so it lands under Grup.
 */
export function completedTaskFieldForReason(
  volunteerField: 'executorId' | 'groupId',
): Readonly<Record<string, string>> {
  return {
    title_required: 'title',
    title_too_short: 'title',
    title_too_long: 'title',
    description_too_long: 'description',
    task_group_required: 'groupId',
    task_group_unavailable: 'groupId',
    group_archived: 'groupId',
    ...Object.fromEntries(
      EXECUTOR_REASONS.map((reason) => [reason, volunteerField]),
    ),
    invalid_campaign: 'campaignId',
    ...linksFieldForReason('links'),
    ...evaluationFields,
  };
}
