import { z } from 'zod';
import { requiredText } from './text';

/**
 * A Difficulty or Rating: a whole number from 1 to `max`, as a picker sends
 * it — a Rating 1–5, a Difficulty 1–10 (#985: five stars, three medals,
 * Responsabil, Coordonator).
 */
const score = (reason: string, max: number) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    const number = value === '' ? Number.NaN : Number(value);
    if (!Number.isInteger(number) || number < 1 || number > max) {
      ctx.addIssue({ code: 'custom', message: reason });
      return z.NEVER;
    }
    return number;
  });

/**
 * An Evaluation (#673, ruling R8; #985): Difficulty 1–10, Rating 1–5 and a required
 * note of at most 1000 characters — `complete_task_review`,
 * `mark_task_unfulfilled` and `approve_completed_work_request`.
 */
export const evaluationShape = {
  difficulty: score('invalid_difficulty', 10),
  rating: score('invalid_rating', 5),
  note: requiredText({
    required: 'evaluation_note_required',
    max: 1000,
    tooLong: 'evaluation_note_too_long',
  }),
};
export const evaluationSchema = z.object(evaluationShape);

/** Where each reason an evaluating command (or this schema) raises is shown. */
export const fieldForReason: Readonly<
  Record<string, 'difficulty' | 'rating' | 'note'>
> = {
  invalid_difficulty: 'difficulty',
  invalid_rating: 'rating',
  evaluation_note_required: 'note',
  evaluation_note_too_long: 'note',
  note_too_long: 'note',
};
