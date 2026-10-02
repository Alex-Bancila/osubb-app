import { useId, useRef, useState, type FormEvent } from 'react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/dialog';
import { FieldError } from '../ui/field';
import { evaluationSchema, fieldForReason } from '../../lib/schemas/evaluation';
import { useFormValidation } from '../../lib/use-form-validation';
import { previewPoints } from '../../lib/difficulty-levels';
import { useEvaluationScale } from '../../queries/reference';
import { RatingGuideDialog } from '../../screens/tracker/RatingGuideDialog';
import { EvaluationInputs } from './EvaluationInputs';

export function EvaluationFields({
  executorName,
  onCancel,
  onSuccess,
  onEvaluate,
  isPending,
  outcome = 'completed',
  inDialog = false,
  groupId,
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
  /** "unfulfilled" scores an overdue Task as Nerealizat instead of closing it as completed. */
  outcome?: 'completed' | 'unfulfilled';
  /**
   * Hosted in a dialog whose header already titles it: no box of its own, no
   * title, and the buttons in the dialog footer (#842, X11; #855, R1).
   */
  inDialog?: boolean;
  /** The Task's Group: the guide opens on its list (#986). */
  groupId?: number | null;
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
  const points = previewPoints(scale.data, difficulty, rating);
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
  const submitButton = (
    <Button
      type="submit"
      className="min-h-11"
      disabled={isPending || !scale.data}
    >
      {isPending ? 'Se salvează…' : 'Confirmă evaluarea'}
    </Button>
  );
  const cancelButton = (label: string) => (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      disabled={isPending}
      onClick={onCancel}
    >
      {label}
    </Button>
  );
  return (
    <form
      onSubmit={submit}
      className={cn(
        'space-y-4',
        !inDialog && 'rounded-lg border border-border p-4',
      )}
      aria-label="Evaluare finală"
      noValidate
    >
      {!inDialog && (
        <h3 className="font-semibold">
          {outcome === 'unfulfilled' ? 'Nerealizat' : 'Evaluare finală'}
        </h3>
      )}
      <p className="text-sm">
        Executor: {executorName ?? 'Membrul'}. Evaluarea încheie taskul și
        acordă punctele acestei persoane.
      </p>
      {outcome === 'unfulfilled' && (
        <p>
          Confirmarea marchează taskul Nerealizat și păstrează încercarea în
          istoric. Evaluarea poate acorda zero puncte sau poate scădea puncte.
        </p>
      )}
      <RatingGuideDialog
        groupId={groupId}
        selection={{
          difficulty: difficulty === '' ? null : Number(difficulty),
          rating: rating === '' ? null : Number(rating),
        }}
        onSet={(patch) => {
          if (patch.difficulty !== undefined)
            setDifficulty(String(patch.difficulty));
          if (patch.rating !== undefined) setRating(String(patch.rating));
        }}
      />
      {scale.isPending && (
        <p role="status" className="text-sm">
          Se încarcă dificultățile și notele…
        </p>
      )}
      {scale.isError && (
        <div role="alert" className="space-y-2 text-sm">
          <p>Nu am putut încărca dificultățile și notele.</p>
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
      <EvaluationInputs
        id={id}
        values={{ difficulty, rating, note }}
        onChange={(patch) => {
          if (patch.difficulty !== undefined) setDifficulty(patch.difficulty);
          if (patch.rating !== undefined) setRating(patch.rating);
          if (patch.note !== undefined) setNote(patch.note);
        }}
        form={form}
        disabled={isPending || !scale.data}
        points={points}
      />
      <FieldError>{form.formError}</FieldError>
      {inDialog ? (
        <DialogFooter>
          {cancelButton('Renunță')}
          {submitButton}
        </DialogFooter>
      ) : (
        <div className="flex flex-wrap gap-2">
          {submitButton}
          {cancelButton('Înapoi')}
        </div>
      )}
    </form>
  );
}
