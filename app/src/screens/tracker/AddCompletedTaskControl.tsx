import { useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Loading, ErrorState } from '../../components/states';
import {
  CompletedTaskForm,
  type FixedVolunteer,
} from '../../components/tasks/CompletedTaskForm';
import { VolunteerPicker } from '../../components/tasks/VolunteerPicker';
import { FabAction } from '../../components/layout';
import { FormSheet } from '../../components/ui/form-sheet';
import { describeFailure } from '../../lib/command-reasons';
import {
  useCompletedTaskGroups,
  useCompletedTaskOptions,
  useCreateCompletedTasks,
  type CompletedTaskDraft,
  type CompletedTaskOptions,
  type CreateCompletedTasksInput,
} from '../../queries/completed-tasks';
import { useTaskManagement } from '../../queries/task-tabs';
import { CopiesExecutorsDialog } from './CopiesExecutorsDialog';

/** The finished Tasks just added: one id as before, several at once (Part E). */
type Added = (added: { ids: number[]; title: string }) => void;

/**
 * "Adaugă task finalizat" (#915) in Taskuri › De gestionat, beside "Task
 * nou": for a viewer who may create Tasks (`can_manage_tasks()`, the same
 * read "Task nou" uses). They choose the Group, then the volunteer — or how
 * many copies, and then one volunteer per copy in a second step, the same
 * person allowed more than once (spec 2026-10-11, Part E). The form opens in
 * a form sheet.
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
 * them. Shown only when there is at least one such Group. One copy.
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
  const create = useCreateCompletedTasks();
  // Each opening starts from an empty form; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // A draft with several copies waits here for its volunteers.
  const [pendingDraft, setPendingDraft] = useState<CompletedTaskDraft | null>(
    null,
  );
  const [stepError, setStepError] = useState<string | null>(null);
  // After a Task is added, focus belongs to its receipt, not this button.
  const added = useRef(false);
  async function finish(input: CreateCompletedTasksInput) {
    const tasks = await create.mutateAsync(input);
    added.current = true;
    setPendingDraft(null);
    onOpenChange(false);
    onAdded({
      ids: tasks.map((task) => task.id),
      title: tasks[0]?.title ?? input.draft.title,
    });
  }
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
            copies={volunteer === null}
            submitLabel="Adaugă și acordă punctele"
            isPending={create.isPending}
            onCancel={() => {
              if (!create.isPending) onOpenChange(false);
            }}
            onSubmit={async (draft) => {
              if (draft.copies > 1) {
                setStepError(null);
                setPendingDraft(draft);
                return;
              }
              await finish({ draft });
            }}
          />
        )}
      </FormSheet>
      {pendingDraft && (
        <CopiesExecutorsDialog
          count={pendingDraft.copies}
          title={`Voluntarii celor ${pendingDraft.copies} taskuri finalizate`}
          description="Alege câte un voluntar pentru fiecare exemplar."
          confirmLabel={`Adaugă ${pendingDraft.copies} taskuri și acordă punctele`}
          busyLabel="Se salvează…"
          allowRepeats
          renderPicker={({ index, value, disabled, onChange }) => (
            <VolunteerPicker
              groupId={pendingDraft.groupId}
              label={`Exemplarul ${index + 1}`}
              value={value}
              onChange={onChange}
              disabled={disabled}
            />
          )}
          busy={create.isPending}
          error={stepError}
          onBack={() => setPendingDraft(null)}
          onConfirm={async (executorIds) => {
            setStepError(null);
            try {
              await finish({ draft: pendingDraft, executorIds });
            } catch (failure) {
              setStepError(
                describeFailure(
                  failure,
                  'Nu am putut adăuga taskurile finalizate. Încearcă din nou.',
                ).message,
              );
            }
          }}
        />
      )}
    </>
  );
}
