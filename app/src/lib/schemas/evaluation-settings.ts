import { z } from 'zod';
import { ISO_DAY } from './date-range';

/** Postgres `integer`'s ceiling: `set_eligibility_floor` takes one. */
const INT_MAX = 2_147_483_647;

/**
 * The **Prag minim** (Eligibility Floor, R58) as `set_eligibility_floor`
 * takes it: a whole number of Task Points, at least 1, so a computed line is
 * always a legal Promotion Threshold. The field is text, so the digits are
 * checked before the number is.
 */
export const floorSchema = z.object({
  floor: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > INT_MAX)
        ctx.addIssue({
          code: 'custom',
          message: 'invalid_eligibility_floor',
        });
    })
    .transform(Number),
});

export const floorFieldForReason: Readonly<Record<string, 'floor'>> = {
  invalid_eligibility_floor: 'floor',
  nothing_to_update: 'floor',
};

/**
 * A setting that is a day: present, a real day and not after `today` (a
 * Bucharest day, given by the caller), as `set_membership_cutoff` and
 * `set_points_start_date` check it — both refuse a missing date with the
 * reason a future one gets. Two ISO days compare correctly as strings.
 */
function dayNotAfterToday(today: string, reason: string) {
  return z.object({
    date: z.string().superRefine((value, ctx) => {
      if (!ISO_DAY.test(value) || value > today)
        ctx.addIssue({ code: 'custom', message: reason });
    }),
  });
}

/** The **Data limită de intrare** (Membership Cutoff Date, R58). */
export function cutoffSchema(today: string) {
  return dayNotAfterToday(today, 'invalid_membership_cutoff');
}

export const cutoffFieldForReason: Readonly<Record<string, 'date'>> = {
  invalid_membership_cutoff: 'date',
  nothing_to_update: 'date',
};

/** The **Data de început a punctajului** (Points Start Date, R58). */
export function pointsStartSchema(today: string) {
  return dayNotAfterToday(today, 'invalid_points_start_date');
}

export const pointsStartFieldForReason: Readonly<Record<string, 'date'>> = {
  invalid_points_start_date: 'date',
  nothing_to_update: 'date',
};
