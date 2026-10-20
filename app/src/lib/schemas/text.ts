import { z } from 'zod';
import { visibleLength } from '../formatted-text/plain';
import { charLength, emptyToNull, trimText } from '../normalize';

/**
 * The text rules every entity schema shares. Each issue's message is a reason
 * code from `lib/command-reasons.ts`, never copy: the rule broken in the
 * browser and the same rule refused by the server read the same.
 *
 * A value is trimmed before it is measured (ruling R6), exactly as each #673
 * command measures what it stores, and it raises one reason, in the server's
 * order: blank is `*_required`, then too short, then too long.
 */
export type TextRule = {
  /** Reason for a blank value; absent means blank passes as `''`. */
  required?: string;
  min?: number;
  tooShort?: string;
  max?: number;
  tooLong?: string;
};

function measure(value: string, rule: TextRule, ctx: z.RefinementCtx) {
  const length = charLength(value);
  if (rule.min !== undefined && length < rule.min)
    ctx.addIssue({
      code: 'custom',
      message: rule.tooShort ?? rule.required ?? 'invalid',
    });
  else if (rule.max !== undefined && length > rule.max)
    ctx.addIssue({ code: 'custom', message: rule.tooLong ?? 'invalid' });
}

/** A text the command needs: trimmed, never blank, within its limits. */
export function requiredText(rule: TextRule & { required: string }) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === '')
        ctx.addIssue({ code: 'custom', message: rule.required });
      else measure(value, rule, ctx);
    });
}

/** A text the member may leave empty: trimmed, and blank becomes `null`. */
export function optionalText(rule: Omit<TextRule, 'required'> = {}) {
  return z
    .string()
    .nullish()
    .transform((value) => emptyToNull(trimText(value)))
    .superRefine((value, ctx) => {
      if (value !== null) measure(value, rule, ctx);
    });
}

/**
 * Formatted Text (ruling R60) is at most 2000 characters as the reader sees
 * them (`visibleLength`) and at most 4000 as stored, the rule of
 * `private.require_formatted_text_length`. The stored cap is judged first, so
 * the stripper never runs on an unbounded value.
 */
function measureFormatted(
  value: string,
  tooLong: string,
  ctx: z.RefinementCtx,
) {
  if (charLength(value) > 4000 || visibleLength(value) > 2000)
    ctx.addIssue({ code: 'custom', message: tooLong });
}

/** A Formatted Text the command needs: trimmed, never blank, within R60's limits. */
export function requiredFormattedText(rule: {
  required: string;
  tooLong: string;
}) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === '')
        ctx.addIssue({ code: 'custom', message: rule.required });
      else measureFormatted(value, rule.tooLong, ctx);
    });
}

/** A Formatted Text the member may leave empty: trimmed, and blank becomes `null`. */
export function optionalFormattedText(rule: { tooLong: string }) {
  return z
    .string()
    .nullish()
    .transform((value) => emptyToNull(trimText(value)))
    .superRefine((value, ctx) => {
      if (value !== null) measureFormatted(value, rule.tooLong, ctx);
    });
}

/** Postgres `integer` ids are positive safe integers. */
export function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
