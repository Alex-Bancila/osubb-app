import { z } from 'zod';
import { requiredText } from './text';

/** A Difficulty or Rating: a whole number from 1 to 5, as a select sends it. */
const score = (reason: string) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    const number = value === '' ? Number.NaN : Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 5) {
      ctx.addIssue({ code: 'custom', message: reason });
      return z.NEVER;
    }
    return number;
  });

/**
 * An Evaluation (#673, ruling R8): Difficulty and Rating 1–5 and a required
 * note of at most 1000 characters — `complete_task_review`,
 * `mark_task_unfulfilled` and `approve_completed_work_request`.
 */
export const evaluationSchema = z.object({
  difficulty: score('invalid_difficulty'),
  rating: score('invalid_rating'),
  note: requiredText({
    required: 'evaluation_note_required',
    max: 1000,
    tooLong: 'note_too_long',
  }),
});

/** Where each reason an evaluating command (or this schema) raises is shown. */
export const fieldForReason: Readonly<
  Record<string, 'difficulty' | 'rating' | 'note'>
> = {
  invalid_difficulty: 'difficulty',
  invalid_rating: 'rating',
  evaluation_note_required: 'note',
  note_too_long: 'note',
};
