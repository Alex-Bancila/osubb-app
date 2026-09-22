import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { TaskForm } from './TaskForm';
import type { TaskDraft } from './task-form-model';
import {
  taskDraftErrorMessage,
  validateTaskDraft,
} from './task-draft-validation';

export function ManagedTaskForm({
  onDraft,
  parentTaskId = null,
  allowSubtask,
  heading,
  submitLabel,
  pendingLabel = 'Se verifică opțiunile actuale…',
}: {
  onDraft: (draft: TaskDraft) => void | Promise<void>;
  parentTaskId?: number | null;
  allowSubtask?: boolean;
  heading?: string | null;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const query = useTaskFormOptions();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  async function prepare(draft: TaskDraft) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const fresh = await query.refetch();
      if (fresh.isError || !fresh.data) {
        setError('Nu am putut verifica opțiunile actuale. Încearcă din nou.');
        return;
      }
      const invalid = validateTaskDraft(draft, fresh.data);
      if (invalid) {
        setError(invalid);
        return;
      }
      await onDraft(draft);
    } catch (failure) {
      setError(taskDraftErrorMessage(failure));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  if (query.isPending)
    return <p role="status">Se încarcă opțiunile taskului…</p>;
  return (
    <div className="space-y-3">
      {query.isError && (
        <div role="alert" className="space-y-2">
          <p>Nu am putut încărca opțiunile taskului.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Reîncearcă
          </Button>
        </div>
      )}
      {query.data && (
        <fieldset disabled={pending} className="min-w-0">
          <TaskForm
            key={parentTaskId ?? 'new-task'}
            options={query.data}
            onDraft={prepare}
            parentTaskId={parentTaskId}
            allowSubtask={allowSubtask}
            heading={heading}
            submitLabel={submitLabel}
          />
        </fieldset>
      )}
      {pending && <p role="status">{pendingLabel}</p>}
      {error && !query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
