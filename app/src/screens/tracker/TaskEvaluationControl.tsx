import { TaskActionSuccess } from './TaskActionSuccess';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useEvaluationScale } from '../../queries/reference';
import {
  useEvaluateTask,
  useTaskEvaluationCapability,
} from '../../queries/task-review';
import type { TaskStatus } from './task-presentation';
import { RatingGuideDialog } from './RatingGuideDialog';

export function TaskEvaluationControl({
  taskId,
  status,
  kind,
  executorName,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  executorName: string | null;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [previousStatus, setPreviousStatus] = useState(status);
  if (previousStatus !== status) {
    setPreviousStatus(status);
    if (status !== 'completed') setDone(false);
  }
  if (done)
    return (
      <TaskActionSuccess>
        Evaluarea a fost salvată. Punctele Executorului au fost actualizate.
      </TaskActionSuccess>
    );
  if (capability.data !== true || status !== 'in_review' || kind !== 'task')
    return null;
  return (
    <section aria-label="Evaluare task" className="space-y-3">
      {open ? (
        <EvaluationForm
          taskId={taskId}
          executorName={executorName}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : (
        <Button
          className="min-h-11"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Evaluează taskul
        </Button>
      )}
    </section>
  );
}

export function EvaluationForm({
  taskId,
  executorName,
  onCancel,
  onSuccess,
}: {
  taskId: number;
  executorName: string | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const id = useId();
  const scale = useEvaluationScale();
  const mutation = useEvaluateTask();
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
      await mutation.mutateAsync({
        taskId,
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
        Executor: {executorName ?? 'Executorul taskului'}. Evaluarea încheie
        taskul și acordă punctele acestei persoane.
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
      <fieldset
        disabled={mutation.isPending || !scale.data}
        className="space-y-3"
      >
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
            : `Previzualizare: ${points} puncte. ${points < 0 ? 'Se scad puncte.' : points === 0 ? 'Nu se acordă puncte.' : 'Se acordă puncte.'} Serverul confirmă punctajul final.`}
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
          disabled={mutation.isPending || !scale.data}
        >
          {mutation.isPending ? 'Se salvează…' : 'Confirmă evaluarea'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Înapoi
        </Button>
      </div>
    </form>
  );
}
