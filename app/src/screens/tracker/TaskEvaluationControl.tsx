import { TaskActionSuccess } from './TaskActionSuccess';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useScoringGuide } from '../../queries/scoring-guide';
import {
  useEvaluateTask,
  useTaskEvaluationCapability,
} from '../../queries/task-review';
import type { TaskStatus } from './task-presentation';
import { ScoringGuide } from './ScoringGuide';

export function TaskEvaluationControl({
  taskId,
  status,
  kind,
  executorName,
  overdue = false,
}: {
  taskId: number;
  status: TaskStatus;
  kind: string;
  executorName: string | null;
  overdue?: boolean;
}) {
  const capability = useTaskEvaluationCapability(taskId);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const canUnfulfilled =
    overdue && ['todo', 'in_progress', 'in_review'].includes(status);
  const [outcome, setOutcome] = useState<'completed' | 'unfulfilled'>(
    'completed',
  );
  if (done)
    return (
      <TaskActionSuccess>
        Evaluarea a fost salvată. Punctele Executorului au fost actualizate.
      </TaskActionSuccess>
    );
  if (
    capability.data !== true ||
    kind !== 'task' ||
    (status !== 'in_review' && !canUnfulfilled)
  )
    return null;
  return (
    <section aria-label="Evaluare task" className="space-y-3">
      {open ? (
        <EvaluationForm
          taskId={taskId}
          outcome={outcome}
          executorName={executorName}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'in_review' && (
            <Button
              className="min-h-11"
              onClick={() => {
                setOutcome('completed');
                setOpen(true);
                setDone(false);
              }}
            >
              Evaluează taskul
            </Button>
          )}
          {canUnfulfilled && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => {
                setOutcome('unfulfilled');
                setOpen(true);
                setDone(false);
              }}
            >
              Marchează nerealizat
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function EvaluationForm({
  taskId,
  executorName,
  onCancel,
  onSuccess,
  outcome = 'completed',
}: {
  taskId: number;
  executorName: string | null;
  onCancel: () => void;
  onSuccess: () => void;
  outcome?: 'completed' | 'unfulfilled';
}) {
  const id = useId();
  const guide = useScoringGuide();
  const mutation = useEvaluateTask();
  const [difficulty, setDifficulty] = useState('');
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const chosen = guide.data?.ratings.find(
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
        ...(outcome === 'unfulfilled' ? { outcome } : {}),
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
      <h3 className="font-semibold">
        {outcome === 'unfulfilled' ? 'Nerealizat' : 'Evaluare finală'}
      </h3>
      <p className="text-sm">
        Executor: {executorName ?? 'Executorul taskului'}. Evaluarea încheie
        taskul și acordă punctele acestei persoane.
      </p>
      {outcome === 'unfulfilled' && (
        <p>
          Confirmarea marchează taskul Nerealizat și păstrează încercarea în
          istoric. Evaluarea poate acorda zero puncte sau poate scădea puncte.
        </p>
      )}
      <ScoringGuide />
      <fieldset
        disabled={mutation.isPending || !guide.data}
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
          {guide.data?.difficulties.map((row) => (
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
          {guide.data?.ratings.map((row) => (
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
          disabled={mutation.isPending || !guide.data}
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
