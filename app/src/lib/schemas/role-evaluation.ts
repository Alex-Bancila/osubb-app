import { z } from 'zod';
import { ISO_DAY } from './date-range';
import { requiredText } from './text';

/** The two Role Evaluation kinds (#826, ruling R28). */
export const ROLE_EVALUATION_KINDS = [
  'voluntar_activ',
  'adunarea_generala',
] as const;
export type RoleEvaluationKind = (typeof ROLE_EVALUATION_KINDS)[number];

/** Postgres `integer`'s ceiling: `set_promotion_threshold` takes one. */
const INT_MAX = 2_147_483_647;

/**
 * The **Rulează o evaluare de rol** form, as `run_role_evaluation` (#826)
 * checks it before its gate: a kind, both days of the Evaluation Period with
 * **Până la** not before **De la** and not after `today` (a Bucharest day,
 * given by the caller), and a name trimmed to 3–120 characters. Two ISO days
 * compare correctly as strings.
 */
export function runSchema(today: string) {
  return z
    .object({
      kind: z
        .string()
        .refine(
          (kind) => (ROLE_EVALUATION_KINDS as readonly string[]).includes(kind),
          { message: 'invalid_role_evaluation_kind' },
        )
        .transform((kind) => kind as RoleEvaluationKind),
      from: z.string(),
      to: z.string(),
      name: requiredText({
        required: 'invalid_role_evaluation_name',
        min: 3,
        tooShort: 'name_too_short',
        max: 120,
        tooLong: 'name_too_long',
      }),
    })
    .superRefine((values, ctx) => {
      // An empty date input reports '': the day is missing, not misordered.
      if (!ISO_DAY.test(values.from))
        ctx.addIssue({
          code: 'custom',
          path: ['from'],
          message: 'date_required',
        });
      if (!ISO_DAY.test(values.to))
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'date_required',
        });
      else if (ISO_DAY.test(values.from) && values.to < values.from)
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'invalid_date_range',
        });
      else if (values.to > today)
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'date_range_in_future',
        });
    });
}

export type RunValues = z.output<ReturnType<typeof runSchema>>;

/** Where each reason the run form (or `run_role_evaluation`) raises is shown. */
export const runFieldForReason: Readonly<
  Record<string, 'kind' | 'from' | 'to' | 'name'>
> = {
  invalid_role_evaluation_kind: 'kind',
  date_required: 'to',
  invalid_date_range: 'to',
  date_range_in_future: 'to',
  invalid_role_evaluation_name: 'name',
  name_too_short: 'name',
  name_too_long: 'name',
};

/**
 * A Promotion Threshold as `set_promotion_threshold` takes it: a whole number
 * of Task Points, at least 1. The field is text, so the digits are checked
 * before the number is.
 */
export const thresholdSchema = z.object({
  threshold: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > INT_MAX)
        ctx.addIssue({
          code: 'custom',
          message: 'invalid_promotion_threshold',
        });
    })
    .transform(Number),
});

export const thresholdFieldForReason: Readonly<Record<string, 'threshold'>> = {
  invalid_promotion_threshold: 'threshold',
  nothing_to_update: 'threshold',
};

/**
 * A kind's top share as `set_evaluation_percent` (#866, ruling R30) takes it:
 * a whole percentage from 1 to 100 — x for Voluntar Activ, y for the
 * Adunarea Generală. The field is text, so the digits are checked first.
 */
export const percentSchema = z.object({
  percent: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100)
        ctx.addIssue({ code: 'custom', message: 'invalid_percent' });
    })
    .transform(Number),
});

export const percentFieldForReason: Readonly<Record<string, 'percent'>> = {
  invalid_percent: 'percent',
  nothing_to_update: 'percent',
};

/**
 * The reason BC gives for rejecting a Promotion Candidate
 * (`reject_promotion_candidate`): required, trimmed, at most 500 characters.
 * The limit is half the shared 1000 of `reason_too_long`, so the browser says
 * 500 with its own reason; the server's `reason_too_long` lands on the same
 * field.
 */
export const rejectionSchema = z.object({
  reason: requiredText({
    required: 'invalid_rejection_reason',
    max: 500,
    tooLong: 'rejection_reason_too_long',
  }),
});

export const rejectionFieldForReason: Readonly<Record<string, 'reason'>> = {
  invalid_rejection_reason: 'reason',
  rejection_reason_too_long: 'reason',
  reason_too_long: 'reason',
};
