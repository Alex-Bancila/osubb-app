import { FieldError } from '../ui/field';
import { formatPoints } from '../../lib/format';
import type { useFormValidation } from '../../lib/use-form-validation';
import { ratingHint } from '../../screens/tracker/rating-guide-content';
import { DifficultyStarPicker } from './DifficultyStars';
import { RatingPicker } from './RatingPicker';

export type EvaluationInputValues = {
  difficulty: string;
  rating: string;
  note: string;
};

/** The slice of `useFormValidation` the three inputs register with. */
type Bound = Pick<
  ReturnType<typeof useFormValidation>,
  'field' | 'errorProps' | 'error' | 'errorId' | 'slot'
>;

/**
 * An Evaluation's three inputs (ruling R29a) — Dificultate as five stars,
 * Nota as a number, the required Observații — with the points preview
 * between them. One definition for every form that evaluates: the Evaluation
 * dialog (`EvaluationFields`) and the completed-Task form (#915). The caller
 * owns the values and the validation; the server computes the real points.
 */
export function EvaluationInputs({
  id,
  values,
  onChange,
  form,
  disabled,
  difficultyHint,
  points,
}: {
  /** A `useId()` of the caller, so the note's label finds its textarea. */
  id: string;
  values: EvaluationInputValues;
  onChange: (patch: Partial<EvaluationInputValues>) => void;
  form: Bound;
  disabled: boolean;
  difficultyHint: (value: number) => string | null;
  /** The preview: Difficulty x the Rating's multiplier, null until both are chosen. */
  points: number | null;
}) {
  const { difficulty, rating, note } = values;
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="sr-only">
        Dificultate, notă și observații obligatorii
      </legend>
      <DifficultyStarPicker
        label="Dificultate (obligatoriu)"
        prompt="Alege între 1 și 5 stele: 1 e cel mai ușor, 5 cel mai greu."
        value={difficulty === '' ? null : Number(difficulty)}
        onChange={(value) => onChange({ difficulty: String(value) })}
        hint={difficultyHint}
        disabled={disabled}
        invalid={form.error('difficulty') !== undefined}
        errorId={form.errorId('difficulty')}
        groupRef={form.slot('difficulty').ref}
      />
      <FieldError {...form.errorProps('difficulty')} />
      <RatingPicker
        label="Nota (obligatoriu)"
        prompt="Alege o notă între 1 și 5."
        value={rating === '' ? null : Number(rating)}
        onChange={(value) => onChange({ rating: String(value) })}
        hint={ratingHint}
        disabled={disabled}
        invalid={form.error('rating') !== undefined}
        errorId={form.errorId('rating')}
        groupRef={form.slot('rating').ref}
      />
      <FieldError {...form.errorProps('rating')} />
      <p role="status" className="rounded-md bg-muted p-3 text-sm">
        {points === null
          ? 'Alege dificultatea și nota pentru previzualizare.'
          : `Previzualizare: ${formatPoints(points)} puncte. ${points < 0 ? 'Se scad puncte.' : points === 0 ? 'Nu se acordă puncte.' : 'Se acordă puncte.'} Serverul confirmă punctajul final.`}
      </p>
      <label htmlFor={`${id}-note`} className="block text-sm font-medium">
        Observații (obligatoriu)
      </label>
      <textarea
        id={`${id}-note`}
        required
        value={note}
        onChange={(event) => onChange({ note: event.target.value })}
        rows={3}
        className="min-h-24 w-full rounded-md border border-input bg-background p-3"
        {...form.field('note')}
      />
      <FieldError {...form.errorProps('note')} />
    </fieldset>
  );
}
