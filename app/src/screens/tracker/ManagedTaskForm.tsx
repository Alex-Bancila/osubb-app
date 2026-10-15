import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useMemberLevel } from '../../lib/auth';
import { CommandError } from '../../lib/command-reasons';
import { taskDraftSchema } from '../../lib/schemas/task';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { TaskForm } from './TaskForm';
import type { TaskDraft } from './task-form-model';

export function ManagedTaskForm({
  onDraft,
  parentTaskId = null,
  allowSubtask,
  heading,
  submitLabel,
  pendingLabel = 'Se verifică opțiunile actuale…',
  onCancel,
  cancelLabel,
  plural,
}: {
  onDraft: (draft: TaskDraft) => void | Promise<void>;
  parentTaskId?: number | null;
  allowSubtask?: boolean;
  heading?: string | null;
  submitLabel?: string;
  pendingLabel?: string;
  /** The footer's secondary action (Renunță), passed to the form. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** The noun the form's button counts; "subtaskuri" under an Umbrella. */
  plural?: 'taskuri' | 'subtaskuri';
}) {
  const query = useTaskFormOptions();
  // R57: Cine îl vede never offers a Role above the actor's own.
  const actorLevel = useMemberLevel();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  /**
   * Re-check the draft against a fresh options read before the command. Any
   * refusal — the fresh read, the schema, the command — is thrown back to the
   * form, which shows it under its field (ruling R8) with the draft kept.
   */
  async function prepare(draft: TaskDraft) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      const fresh = await query.refetch();
      if (fresh.isError || !fresh.data)
        throw new CommandError(
          null,
          'Nu am putut verifica opțiunile actuale. Încearcă din nou.',
        );
      const checked = taskDraftSchema(fresh.data).safeParse(draft);
      if (!checked.success)
        throw new CommandError(
          { message: checked.error.issues[0]?.message },
          'Nu am putut pregăti taskul. Încearcă din nou.',
        );
      await onDraft(checked.data);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  if (query.isPending)
    return <p role="status">Se încarcă opțiunile taskului…</p>;
  return (
    // The chain down to the form's pinned footer stays as tall as the sheet.
    <div className="flex min-w-0 flex-1 flex-col gap-3">
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
        <fieldset disabled={pending} className="flex min-w-0 flex-1 flex-col">
          <TaskForm
            key={parentTaskId ?? 'new-task'}
            options={query.data}
            onDraft={prepare}
            parentTaskId={parentTaskId}
            allowSubtask={allowSubtask}
            heading={heading}
            submitLabel={submitLabel}
            onCancel={onCancel}
            cancelLabel={cancelLabel}
            plural={plural}
            actorLevel={actorLevel}
            status={pending && <p role="status">{pendingLabel}</p>}
          />
        </fieldset>
      )}
    </div>
  );
}
