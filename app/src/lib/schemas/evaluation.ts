import { z } from 'zod';
import { requiredText } from './text';

/**
 * The Difficulty levels and the Rating scale (#985): a Difficulty is one of
 * ten levels — 1–5 stars, 6–8 the Bronz/Argint/Aur medals, 9 Responsabil and
 * 10 Coordonator — and a Rating (Nota) is 1–5. The server's checks and
 * `public.task_difficulty_levels` are the authority; these bounds mirror them.
 */
export const MAX_DIFFICULTY = 10;
export const MAX_RATING = 5;

/** How a Difficulty level is drawn: stars, a medal glyph, or its label alone. */
export const difficultyKindSchema = z.enum(['star', 'medal', 'text']);
export type DifficultyKind = z.infer<typeof difficultyKindSchema>;

/** A whole number from 1 to `max`, as a select sends it. */
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
 * An Evaluation (#673, ruling R8; #985): a Difficulty of 1–10, a Rating of
 * 1–5 and a required note of at most 1000 characters — `complete_task_review`,
 * `mark_task_unfulfilled`, `approve_completed_work_request` and
 * `create_completed_task`.
 */
export const evaluationShape = {
  difficulty: score('invalid_difficulty', MAX_DIFFICULTY),
  rating: score('invalid_rating', MAX_RATING),
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
