import { useRef, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useTaskManagement } from '../../queries/task-tabs';
import { useCreateTask } from '../../queries/task-umbrella';
import { ManagedTaskForm } from './ManagedTaskForm';

/**
 * "Task nou": a top-level Task or Umbrella, for a member who manages work in
 * some Group (the same `can_manage_tasks()` read the Campanii entry uses).
 * Hidden while that read loads or fails; `create_task` stays authoritative.
 * On narrow screens the Dialog fills the screen like a sheet.
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        setOpen(next);
      }}
    >
      <Button
        className="min-h-11"
        onClick={() => {
          created.current = false;
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      >
        <PlusIcon aria-hidden="true" />
        Task nou
      </Button>
      <DialogContent
        finalFocus={() => !created.current}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
      >
        <DialogHeader>
          <DialogTitle>Task nou</DialogTitle>
          <DialogDescription>
            Creează un task sau un task-umbrelă într-un grup pe care îl
            gestionezi. Subtaskurile se adaugă din taskul-umbrelă.
          </DialogDescription>
        </DialogHeader>
        <ManagedTaskForm
          key={attempt}
          allowSubtask={false}
          heading={null}
          submitLabel="Creează taskul"
          pendingLabel="Se creează taskul…"
          onDraft={async (draft) => {
            const task = await create.mutateAsync(draft);
            created.current = true;
            setOpen(false);
            onCreated(task.id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
