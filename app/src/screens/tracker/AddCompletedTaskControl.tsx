import { useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Loading, ErrorState } from '../../components/states';
import {
  CompletedTaskForm,
  type FixedVolunteer,
} from '../../components/tasks/CompletedTaskForm';
import { FabAction } from '../../components/layout';
import { FormSheet } from '../../components/ui/form-sheet';
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
 * read "Task nou" uses). They choose the Group, then the volunteer. The form
 * opens in a form sheet.
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
      onAdded={onAdded}
    />
  );
}

function AddCompletedTaskDialog({
  open,
  onOpenChange,
  options,
  volunteer,
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
  onAdded: Added;
}) {
  const create = useCreateCompletedTask();
  // Each opening starts from an empty form; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // After a Task is added, focus belongs to its receipt, not this button.
  const added = useRef(false);
  return (
    <>
      <FabAction
        label="Adaugă task finalizat"
        icon={ClipboardCheck}
        variant="outline"
        onSelect={() => {
          added.current = false;
          setAttempt((current) => current + 1);
          onOpenChange(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Adaugă task finalizat"
        busy={create.isPending}
        finalFocus={() => !added.current}
        className="sm:max-w-2xl"
      >
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
      </FormSheet>
    </>
  );
}
