import { useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Loading, ErrorState } from '../../components/states';
import {
  CompletedTaskForm,
  type FixedVolunteer,
} from '../../components/tasks/CompletedTaskForm';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  useCompletedTaskGroups,
  useCompletedTaskOptions,
  useCreateCompletedTask,
  type CompletedTaskOptions,
} from '../../queries/completed-tasks';
import { useTaskManagement } from '../../queries/task-tabs';

type Added = (task: { id: number; title: string }) => void;

/**
 * "Adaugă task finalizat" (#915) in Taskuri › De gestionat, beside "Task
 * nou": for a viewer who may create Tasks (`can_manage_tasks()`, the same
 * read "Task nou" uses). They choose the Group, then the volunteer.
 */
export function AddCompletedTaskControl({ onAdded }: { onAdded: Added }) {
  const management = useTaskManagement();
  if (management.data !== true) return null;
  return <ManagedGroupsDialog onAdded={onAdded} />;
}

function ManagedGroupsDialog({ onAdded }: { onAdded: Added }) {
  const [open, setOpen] = useState(false);
  const options = useCompletedTaskOptions(open);
  return (
    <AddCompletedTaskDialog
      open={open}
      onOpenChange={setOpen}
      options={options}
      volunteer={null}
      description="Înregistrează munca pe care un membru al unui grup gestionat de tine a făcut-o deja și acordă-i punctele."
      onAdded={onAdded}
    />
  );
}

/**
 * The same form on Trackerul membrului (#915): the volunteer is the Member
 * whose tracker this is, and the Groups are those where the viewer may credit
 * them. Shown only when there is at least one such Group.
 */
export function AddCompletedTaskForMember({
  volunteer,
  onAdded,
}: {
  volunteer: FixedVolunteer;
  onAdded: Added;
}) {
  const [open, setOpen] = useState(false);
  const groups = useCompletedTaskGroups(volunteer.id);
  if (!groups.data?.groups.length) return null;
  return (
    <AddCompletedTaskDialog
      open={open}
      onOpenChange={setOpen}
      options={groups}
      volunteer={volunteer}
      description="Înregistrează munca pe care acest membru a făcut-o deja într-un grup pe care îl gestionezi și acordă-i punctele."
      onAdded={onAdded}
    />
  );
}

function AddCompletedTaskDialog({
  open,
  onOpenChange,
  options,
  volunteer,
  description,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: {
    data: CompletedTaskOptions | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  volunteer: FixedVolunteer | null;
  description: string;
  onAdded: Added;
}) {
  const create = useCreateCompletedTask();
  // Each opening starts from an empty form; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // After a Task is added, focus belongs to its receipt, not this button.
  const added = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        onOpenChange(next);
      }}
    >
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => {
          added.current = false;
          setAttempt((current) => current + 1);
          onOpenChange(true);
        }}
      >
        <ClipboardCheck aria-hidden="true" />
        Adaugă task finalizat
      </Button>
      <DialogContent
        finalFocus={() => !added.current}
        fullScreenOnPhone
        className="sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Adaugă task finalizat</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {options.isPending ? (
          <Loading label="Se încarcă grupurile…" />
        ) : options.isError || !options.data ? (
          <ErrorState
            error={options.error}
            text="Nu am putut încărca grupurile."
            retryLabel="Reîncearcă"
            onRetry={() => void options.refetch()}
          />
        ) : (
          <CompletedTaskForm
            key={attempt}
            options={options.data}
            volunteer={volunteer}
            submitLabel="Adaugă și acordă punctele"
            isPending={create.isPending}
            onCancel={() => {
              if (!create.isPending) onOpenChange(false);
            }}
            onSubmit={async (draft) => {
              const task = await create.mutateAsync(draft);
              added.current = true;
              onOpenChange(false);
              onAdded({ id: task.id, title: task.title });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
