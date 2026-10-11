import { useRef, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { FabAction } from '../../components/layout';
import { FormSheet } from '../../components/ui/form-sheet';
import { commandErrorMessage } from '../../lib/command-reasons';
import { useTaskManagement } from '../../queries/task-tabs';
import {
  useCreateTasks,
  type CreateTasksInput,
} from '../../queries/task-umbrella';
import { CopiesExecutorsDialog } from './CopiesExecutorsDialog';
import { ManagedTaskForm } from './ManagedTaskForm';
import type { TaskDraft } from './task-form-model';

export type TasksCreated = { ids: number[] };

/**
 * "Task nou": a top-level Task or Umbrella, for a member who manages work in
 * some Group (the same `can_manage_tasks()` read the Campanii entry uses).
 * Hidden while that read loads or fails; `create_tasks` stays authoritative.
 * The form opens in a form sheet; n direct copies add a second step, the
 * executors dialog, before anything is created (spec 2026-10-11).
 */
export function NewTaskControl({
  onCreated,
}: {
  onCreated: (created: TasksCreated) => void;
}) {
  const management = useTaskManagement();
  if (management.data !== true) return null;
  return <NewTaskDialog onCreated={onCreated} />;
}

function NewTaskDialog({
  onCreated,
}: {
  onCreated: (created: TasksCreated) => void;
}) {
  const create = useCreateTasks();
  const [open, setOpen] = useState(false);
  // Each opening starts from an empty draft; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // A direct draft with several copies waits here for its Executors.
  const [pendingDraft, setPendingDraft] = useState<TaskDraft | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  // After a Task opens, focus belongs to its details, not this button.
  const created = useRef(false);
  async function finish(input: CreateTasksInput) {
    const tasks = await create.mutateAsync(input);
    created.current = tasks.length === 1;
    setPendingDraft(null);
    setOpen(false);
    onCreated({ ids: tasks.map((task) => task.id) });
  }
  return (
    <>
      <FabAction
        label="Task nou"
        icon={PlusIcon}
        onSelect={() => {
          created.current = false;
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Task nou"
        busy={create.isPending}
        finalFocus={() => !created.current}
        className="sm:max-w-2xl"
      >
        <ManagedTaskForm
          key={attempt}
          allowSubtask={false}
          heading={null}
          submitLabel="Creează taskul"
          pendingLabel="Se creează taskul…"
          onCancel={() => {
            if (!create.isPending) setOpen(false);
          }}
          onDraft={async (draft) => {
            if (draft.assignmentMode === 'direct' && draft.copies > 1) {
              setStepError(null);
              setPendingDraft(draft);
              return;
            }
            await finish({ draft });
          }}
        />
      </FormSheet>
      {pendingDraft && (
        <CopiesExecutorsDialog
          count={pendingDraft.copies}
          originGroupId={pendingDraft.groupId}
          plural="taskuri"
          busy={create.isPending}
          error={stepError}
          onBack={() => setPendingDraft(null)}
          onConfirm={async (executorIds) => {
            setStepError(null);
            try {
              await finish({ draft: pendingDraft, executorIds });
            } catch (failure) {
              setStepError(
                commandErrorMessage(
                  failure,
                  'Nu am putut crea taskurile. Încearcă din nou.',
                ),
              );
            }
          }}
        />
      )}
    </>
  );
}
