import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
import { evaluationSchema, fieldForReason } from '../../lib/schemas/evaluation';
import { useFormValidation } from '../../lib/use-form-validation';
import { useEvaluationScale } from '../../queries/reference';
import { formatPoints } from '../../lib/format';
import { RatingGuideDialog } from '../../screens/tracker/RatingGuideDialog';

export function EvaluationFields({
  executorName,
  onCancel,
  onSuccess,
  onEvaluate,
  isPending,
  request = false,
  outcome = 'completed',
}: {
  executorName: string | null;
  onCancel: () => void;
  onSuccess: () => void;
  onEvaluate: (values: {
    difficulty: number;
    rating: number;
    note: string;
  }) => Promise<unknown>;
  isPending: boolean;
  request?: boolean;
  /** "unfulfilled" scores an overdue Task as Nerealizat instead of closing it as completed. */
  outcome?: 'completed' | 'unfulfilled';
}) {
  const id = useId();
  const scale = useEvaluationScale();
  const [difficulty, setDifficulty] = useState('');
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const form = useFormValidation(
    evaluationSchema,
    { difficulty, rating, note },
    fieldForReason,
  );
  const submitting = useRef(false);
  const chosen = scale.data?.ratings.find(
    (row) => row.rating === Number(rating),
  );
  const points =
    difficulty && chosen ? Number(difficulty) * chosen.multiplier : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const values = form.validate();
    if (!values) return;
    submitting.current = true;
    try {
      await onEvaluate(values);
      onSuccess();
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva evaluarea. Încearcă din nou.');
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-border p-4"
      aria-label="Evaluare finală"
      noValidate
    >
      <h3 className="font-semibold">
        {outcome === 'unfulfilled' ? 'Nerealizat' : 'Evaluare finală'}
      </h3>
      <p className="text-sm">
        {request ? 'Solicitant' : 'Executor'}: {executorName ?? 'Membrul'}.{' '}
        {request
          ? 'Aprobarea înregistrează activitatea realizată și acordă punctele solicitantului.'
          : 'Evaluarea încheie taskul și acordă punctele acestei persoane.'}
      </p>
      {outcome === 'unfulfilled' && (
        <p>
          Confirmarea marchează taskul Nerealizat și păstrează încercarea în
          istoric. Evaluarea poate acorda zero puncte sau poate scădea puncte.
        </p>
      )}
      <RatingGuideDialog />
      {scale.isPending && (
        <p role="status" className="text-sm">
          Se încarcă dificultățile și calificativele…
        </p>
      )}
      {scale.isError && (
        <div role="alert" className="space-y-2 text-sm">
          <p>Nu am putut încărca dificultățile și calificativele.</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={scale.isFetching}
            onClick={() => void scale.refetch()}
          >
            Reîncarcă
          </Button>
        </div>
      )}
      <fieldset disabled={isPending || !scale.data} className="space-y-3">
        <legend className="sr-only">
          Dificultate, calificativ și notă obligatorii
        </legend>
        <label
          htmlFor={`${id}-difficulty`}
          className="block text-sm font-medium"
        >
          Dificultate (obligatoriu)
        </label>
        <select
          id={`${id}-difficulty`}
          required
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3"
          {...form.field('difficulty')}
        >
          <option value="">Alege dificultatea</option>
          {scale.data?.difficulties.map((row) => (
            <option key={row.stars} value={row.stars}>
              {row.stars} — {row.note}
            </option>
          ))}
        </select>
        <FieldError {...form.errorProps('difficulty')} />
        <label htmlFor={`${id}-rating`} className="block text-sm font-medium">
          Calificativ (obligatoriu)
        </label>
        <select
          id={`${id}-rating`}
          required
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3"
          {...form.field('rating')}
        >
          <option value="">Alege calificativul</option>
          {scale.data?.ratings.map((row) => (
            <option key={row.rating} value={row.rating}>
              {row.rating} — {row.label}
            </option>
          ))}
        </select>
        <FieldError {...form.errorProps('rating')} />
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          {points === null
            ? 'Alege dificultatea și calificativul pentru previzualizare.'
            : `Previzualizare: ${formatPoints(points)} puncte. ${points < 0 ? 'Se scad puncte.' : points === 0 ? 'Nu se acordă puncte.' : 'Se acordă puncte.'} Serverul confirmă punctajul final.`}
        </p>
        <label htmlFor={`${id}-note`} className="block text-sm font-medium">
          Notă (obligatoriu)
        </label>
        <textarea
          id={`${id}-note`}
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="min-h-24 w-full rounded-md border border-input bg-background p-3"
          {...form.field('note')}
        />
        <FieldError {...form.errorProps('note')} />
      </fieldset>
      <FieldError>{form.formError}</FieldError>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          className="min-h-11"
          disabled={isPending || !scale.data}
        >
          {isPending
            ? 'Se salvează…'
            : request
              ? 'Aprobă cererea'
              : 'Confirmă evaluarea'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={isPending}
          onClick={onCancel}
        >
          Înapoi
        </Button>
      </div>
    </form>
  );
}
