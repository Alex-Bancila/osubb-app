import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
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
}) {
  const id = useId();
  const scale = useEvaluationScale();
  const [difficulty, setDifficulty] = useState('');
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const chosen = scale.data?.ratings.find(
    (row) => row.rating === Number(rating),
  );
  const points =
    difficulty && chosen ? Number(difficulty) * chosen.multiplier : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!difficulty || !rating || !note.trim() || !chosen) {
      setError('Alege Dificultatea, Calificativul și scrie o notă.');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      await onEvaluate({
        difficulty: Number(difficulty),
        rating: Number(rating),
        note: note.trim(),
      });
      onSuccess();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Nu am putut salva evaluarea.',
      );
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
      <h3 className="font-semibold">Evaluare finală</h3>
      <p className="text-sm">
        {request ? 'Solicitant' : 'Executor'}: {executorName ?? 'Membrul'}.{' '}
        {request
          ? 'Aprobarea înregistrează activitatea realizată și acordă punctele solicitantului.'
          : 'Evaluarea încheie taskul și acordă punctele acestei persoane.'}
      </p>
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
        >
          <option value="">Alege dificultatea</option>
          {scale.data?.difficulties.map((row) => (
            <option key={row.stars} value={row.stars}>
              {row.stars} — {row.note}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-rating`} className="block text-sm font-medium">
          Calificativ (obligatoriu)
        </label>
        <select
          id={`${id}-rating`}
          required
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3"
        >
          <option value="">Alege calificativul</option>
          {scale.data?.ratings.map((row) => (
            <option key={row.rating} value={row.rating}>
              {row.rating} — {row.label}
            </option>
          ))}
        </select>
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
        />
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
