import { useRef, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { FabAction } from '../../components/layout';
import { FormSheet } from '../../components/ui/form-sheet';
import { useTaskManagement } from '../../queries/task-tabs';
import { useCreateTask } from '../../queries/task-umbrella';
import { ManagedTaskForm } from './ManagedTaskForm';

/**
 * "Task nou": a top-level Task or Umbrella, for a member who manages work in
 * some Group (the same `can_manage_tasks()` read the Campanii entry uses).
 * Hidden while that read loads or fails; `create_task` stays authoritative.
 * The form opens in a form sheet.
 */
export function NewTaskControl({
  onCreated,
}: {
  onCreated: (taskId: number) => void;
}) {
  const management = useTaskManagement();
  if (management.data !== true) return null;
  return <NewTaskDialog onCreated={onCreated} />;
}

function NewTaskDialog({ onCreated }: { onCreated: (taskId: number) => void }) {
  const create = useCreateTask();
  const [open, setOpen] = useState(false);
  // Each opening starts from an empty draft; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // After a Task opens, focus belongs to its details, not this button.
  const created = useRef(false);
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
            const task = await create.mutateAsync(draft);
            created.current = true;
            setOpen(false);
            onCreated(task.id);
          }}
        />
      </FormSheet>
    </>
  );
}
