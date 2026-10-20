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
 * The settings a run reads rather than asks for (Setări, R58): the **Prag
 * minim** and, for the Voluntar Activ kind, the **Data limită de intrare**,
 * each `null` until BC has set it.
 */
export type RunSettings = { floor: number | null; cutoff: string | null };

/**
 * The fields the form holds: the kind (the page's section), both days of the
 * Evaluation Period, the kind's **Procent**. The Prag minim and the Data
 * limită de intrare are settings, edited only in Setări.
 */
const rankingFields = {
  kind: z
    .string()
    .refine(
      (kind) => (ROLE_EVALUATION_KINDS as readonly string[]).includes(kind),
      { message: 'invalid_role_evaluation_kind' },
    )
    .transform((kind) => kind as RoleEvaluationKind),
  from: z.string(),
  to: z.string(),
  percent: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100)
        ctx.addIssue({ code: 'custom', message: 'invalid_percent' });
    })
    .transform(Number),
};

/**
 * The rules that read several fields at once: both days of the Evaluation
 * Period, with **Până la** not before **De la** and not after `today`, and the
 * settings the run needs — the **Prag minim**, and for the Voluntar Activ kind
 * only the **Data limită de intrare**. The page does not start a run without
 * them; an unset one raised here is the form's own error.
 */
function checkRanking(
  values: { kind: RoleEvaluationKind; from: string; to: string },
  inForce: RunSettings,
  ctx: z.RefinementCtx,
  today: string,
) {
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
  if (inForce.floor === null)
    ctx.addIssue({
      code: 'custom',
      path: ['floor'],
      message: 'eligibility_floor_not_set',
    });
  // Only the Voluntar Activ kind lists Candidates by the cutoff.
  if (values.kind === 'voluntar_activ' && inForce.cutoff === null)
    ctx.addIssue({
      code: 'custom',
      path: ['cutoff'],
      message: 'membership_cutoff_not_set',
    });
}

/**
 * The values a run and its Simulation send: the form's, with the **Prag
 * minim** and the **Data limită de intrare** in force. The Adunarea Generală
 * has no cutoff, whatever the settings hold. The refinement has already
 * refused an unset Floor, so none reaches here.
 */
function withSettings<T extends { kind: RoleEvaluationKind }>(
  values: T,
  inForce: RunSettings,
) {
  return {
    ...values,
    // The refinement refused an unset Floor, and Zod skips the transform once
    // a refinement has added an issue: here it is a number.
    floor: inForce.floor as number,
    cutoff: values.kind === 'voluntar_activ' ? inForce.cutoff : null,
  };
}

/**
 * The **Rulează o evaluare** form, as `run_role_evaluation` (#826, R58) checks
 * it before its gate: a kind, both days of the Evaluation Period with **Până
 * la** not before **De la** and not after `today` (a Bucharest day, given by
 * the caller), a name trimmed to 3–120 characters and the **Procent** (a whole
 * number from 1 to 100). The form does not hold the **Prag minim** or the
 * **Data limită de intrare**: Setări does, and the run takes the ones `inForce`
 * (the Floor for both kinds, the cutoff for the Voluntar Activ kind only,
 * `null` for the Adunarea Generală). The Procent is text in the form (digits
 * are checked before the number is) and a number in the output. Two ISO days
 * compare correctly as strings.
 */
export function runSchema(today: string, inForce: RunSettings) {
  return z
    .object({
      ...rankingFields,
      name: requiredText({
        required: 'invalid_role_evaluation_name',
        min: 3,
        tooShort: 'name_too_short',
        max: 120,
        tooLong: 'name_too_long',
      }),
    })
    .superRefine((values, ctx) => checkRanking(values, inForce, ctx, today))
    .transform((values) => withSettings(values, inForce));
}

/**
 * The same form as **Simulează** checks it: every field of the run but its
 * name. A Simulation writes nothing and records no run, so `simulate_role_
 * evaluation` takes no name; the form still holds **Nume**, which only
 * **Finalizează** needs. Whatever the name field holds is neither checked nor
 * carried.
 */
export function simulationSchema(today: string, inForce: RunSettings) {
  return z
    .object(rankingFields)
    .superRefine((values, ctx) => checkRanking(values, inForce, ctx, today))
    .transform((values) => withSettings(values, inForce));
}

/**
 * Where each reason the run form (or its Simulation) raises is shown. Only the
 * fields on screen: a refusal about the Prag minim or the Data limită de
 * intrare (`invalid_eligibility_floor`, `invalid_membership_cutoff`,
 * `membership_cutoff_not_set`) belongs to Setări, so it lands as the form's
 * own error.
 */
export const runFieldForReason: Readonly<
  Record<string, 'kind' | 'from' | 'to' | 'name' | 'percent'>
> = {
  invalid_role_evaluation_kind: 'kind',
  date_required: 'to',
  invalid_date_range: 'to',
  date_range_in_future: 'to',
  invalid_role_evaluation_name: 'name',
  name_too_short: 'name',
  name_too_long: 'name',
  invalid_percent: 'percent',
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
    tooLong: 'candidate_rejection_reason_too_long',
  }),
});

export const rejectionFieldForReason: Readonly<Record<string, 'reason'>> = {
  invalid_rejection_reason: 'reason',
  candidate_rejection_reason_too_long: 'reason',
  reason_too_long: 'reason',
};
