import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  bucharestWallTimeToIso,
  isoToBucharestWallTime,
} from '../../lib/calendar-time';
import {
  fieldForReason,
  taskUpdateSchema,
  type TaskUpdateValues,
} from '../../lib/schemas/task';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  TaskEditNeedsConfirmation,
  previewTaskUpdate,
  useTaskEdit,
  type TaskUpdateConsequence,
  type TaskUpdateInput,
} from '../../queries/task-edit';
import { useTaskFormOptions } from '../../queries/task-form-options';
import type { TaskPresentationRow } from './task-presentation';
import { campaignsFor } from './task-form-model';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
const SAVE_FAILED = 'Nu am putut salva modificările. Reîncearcă.';

/** ADR-0007 (amended 2026-09-21): every field is editable until review. */
function isEditable(status: TaskPresentationRow['status']) {
  return status === 'todo' || status === 'in_progress';
}

export function TaskEditControl({
  task,
  canManage,
}: {
  task: TaskPresentationRow;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const receipt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (saved) receipt.current?.focus();
  }, [saved]);
  const canEdit = canManage && isEditable(task.status);
  return (
    <section aria-label="Editarea taskului" className="space-y-3">
      {saved && (
        <p ref={receipt} role="status" tabIndex={-1}>
          Modificările au fost salvate și înregistrate în istoricul taskului.
        </p>
      )}
      {canEdit &&
        (open ? (
          <TaskEditForm
            task={task}
            onCancel={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              setSaved(true);
            }}
          />
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              setSaved(false);
            }}
          >
            Editează taskul
          </Button>
        ))}
    </section>
  );
}

function consequenceText(consequence: TaskUpdateConsequence) {
  switch (consequence.kind) {
    case 'executor_removed':
      return `${consequence.memberName} nu mai este executor. Taskul revine la „De făcut”.`;
    case 'executor_added_to_group':
      return `${consequence.memberName} va fi adăugat în grupul nou.`;
    case 'campaign_cleared':
      return 'Campania va fi eliminată deoarece nu aparține grupului nou.';
    case 'candidate_removed':
      return `${consequence.memberName} iese din lista de candidați.`;
    default:
      return `Participarea lui ${consequence.memberName} la task se schimbă.`;
  }
}

function TaskEditForm({
  task,
  onCancel,
  onSaved,
}: {
  task: TaskPresentationRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const options = useTaskFormOptions();
  const mutation = useTaskEdit();
  const umbrella = task.kind === 'umbrella';
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const initialDeadline = task.deadline
    ? isoToBucharestWallTime(task.deadline)
    : '';
  const [deadline, setDeadline] = useState(initialDeadline);
  const [campaignId, setCampaignId] = useState<number | null>(task.campaign_id);
  const [assignmentMode, setAssignmentMode] = useState(
    task.assignment_mode === 'public' ? 'public' : 'direct',
  );
  const [audience, setAudience] = useState(
    task.audience === 'org' ? 'org' : 'local',
  );
  const [checking, setChecking] = useState(false);
  // The values waiting for the manager to accept their consequences.
  const [confirming, setConfirming] = useState<{
    input: TaskUpdateInput;
    consequences: TaskUpdateConsequence[];
  } | null>(null);
  const submitting = useRef(false);
  const group = options.data?.groups.find((row) => row.id === task.group_id);
  const campaigns = options.data ? campaignsFor(group, options.data) : [];
  const pending = checking || mutation.isPending;

  function instantFor(value: string) {
    // An untouched deadline keeps its exact stored instant, seconds included;
    // a wall-clock time that does not exist in Romania is '' (the schema's
    // deadline_invalid).
    return value === initialDeadline
      ? task.deadline
      : value
        ? (bucharestWallTimeToIso(value) ?? '')
        : null;
  }
  const values: TaskUpdateValues = {
    title,
    description,
    deadline: instantFor(deadline),
    campaignId: umbrella ? null : campaignId,
    assignmentMode: umbrella
      ? null
      : (assignmentMode as TaskUpdateValues['assignmentMode']),
    audience: umbrella ? null : (audience as TaskUpdateValues['audience']),
  };
  // A Campaign the Task may carry: one offered for its Group, or its own.
  const allowedCampaigns = (offered: { id: number }[]) => [
    ...offered.map((row) => row.id),
    ...(task.campaign_id === null ? [] : [task.campaign_id]),
  ];
  const form = useFormValidation(
    taskUpdateSchema({ umbrella, campaignIds: allowedCampaigns(campaigns) }),
    values,
    fieldForReason,
  );
  const changed =
    title.trim() !== task.title ||
    (description.trim() || null) !== (task.description ?? null) ||
    deadline !== initialDeadline ||
    (!umbrella &&
      (campaignId !== task.campaign_id ||
        values.assignmentMode !== task.assignment_mode ||
        values.audience !== task.audience));

  async function save(update: TaskUpdateInput, acceptConsequences: boolean) {
    try {
      await mutation.mutateAsync({ ...update, acceptConsequences });
      setConfirming(null);
      onSaved();
    } catch (failure) {
      if (failure instanceof TaskEditNeedsConfirmation) {
        // The Task changed since the preview: show the current consequences.
        const consequences = await previewTaskUpdate(update);
        setConfirming(
          consequences.length ? { input: update, consequences } : null,
        );
        if (!consequences.length)
          form.fail(
            null,
            'Taskul s-a schimbat între timp. Verifică și salvează din nou.',
          );
        return;
      }
      throw failure;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = form.validate();
    if (!parsed) return;
    const input: TaskUpdateInput = {
      taskId: task.id,
      groupId: task.group_id,
      ...parsed,
      // #684: the form has no link fields yet (#688), so the current link
      // travels unchanged -- update_task is a full-state replace.
      linkLabel: task.link_label,
      linkUrl: task.link_url,
    };
    submitting.current = true;
    setChecking(true);
    try {
      const fresh = await options.refetch();
      if (fresh.isError || !fresh.data) {
        form.fail(
          null,
          'Nu am putut verifica grupul și campaniile. Reîncearcă.',
        );
        return;
      }
      const origin = fresh.data.groups.find((row) => row.id === task.group_id);
      if (!origin) {
        form.fail({ message: 'task_manage_forbidden' }, SAVE_FAILED);
        return;
      }
      // The same rules against the fresh read: a Campaign may have gone.
      const recheck = taskUpdateSchema({
        umbrella,
        campaignIds: allowedCampaigns(campaignsFor(origin, fresh.data)),
      }).safeParse(values);
      if (!recheck.success) {
        form.fail({ message: recheck.error.issues[0]?.message }, SAVE_FAILED);
        return;
      }
      const consequences = await previewTaskUpdate(input);
      if (consequences.length) {
        setConfirming({ input, consequences });
        return;
      }
      await save(input, false);
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    } finally {
      submitting.current = false;
      setChecking(false);
    }
  }

  async function confirm() {
    if (!confirming || submitting.current) return;
    submitting.current = true;
    try {
      await save(confirming.input, true);
    } catch (failure) {
      setConfirming(null);
      form.fail(failure, SAVE_FAILED);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border p-4"
      aria-label="Editează taskul"
      noValidate
    >
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">Câmpurile taskului</legend>
        <div className="space-y-1">
          <label className="block space-y-1">
            <span>Titlu</span>
            <input
              className={control}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              {...form.field('title')}
            />
          </label>
          <FieldError {...form.errorProps('title')} />
        </div>
        <div className="space-y-1">
          <label className="block space-y-1">
            <span>Descriere</span>
            <textarea
              className={control}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              {...form.field('description')}
            />
          </label>
          <FieldError {...form.errorProps('description')} />
        </div>
        <div className="space-y-1">
          <label className="block space-y-1">
            <span>Termen{umbrella ? ' (opțional)' : ''} — ora României</span>
            <input
              className={control}
              type="datetime-local"
              required={!umbrella}
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              {...form.field('deadline')}
            />
          </label>
          <FieldError {...form.errorProps('deadline')} />
        </div>
        {!umbrella && (
          <>
            <div className="space-y-1">
              <label className="block space-y-1">
                <span>Mod de atribuire</span>
                <select
                  className={control}
                  value={assignmentMode}
                  onChange={(event) => setAssignmentMode(event.target.value)}
                  {...form.field('assignmentMode')}
                >
                  <option value="direct">Direct</option>
                  <option value="public">
                    Public — înscriere prin lista de candidați
                  </option>
                </select>
              </label>
              <FieldError {...form.errorProps('assignmentMode')} />
            </div>
            <div className="space-y-1">
              <label className="block space-y-1">
                <span>Audiență</span>
                <select
                  className={control}
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  {...form.field('audience')}
                >
                  <option value="local">Membrii grupului de origine</option>
                  <option value="org">Toți membrii eligibili OSUBB</option>
                </select>
              </label>
              <FieldError {...form.errorProps('audience')} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-campaign`}>Campanie (opțional)</label>
              <select
                id={`${id}-campaign`}
                className={control}
                value={campaignId ?? ''}
                onChange={(event) =>
                  setCampaignId(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                {...form.field('campaignId', `${id}-campaign-hint`)}
              >
                <option value="">Fără campanie</option>
                {task.campaign_id !== null &&
                  !campaigns.some((row) => row.id === task.campaign_id) && (
                    <option value={task.campaign_id}>
                      {task.campaign?.name ?? 'Campania existentă'} (actuală)
                    </option>
                  )}
                {campaigns.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              <FieldError {...form.errorProps('campaignId')} />
              <p
                id={`${id}-campaign-hint`}
                className="text-sm text-muted-foreground"
              >
                O etichetă pentru raportare: punctele obținute și cine a lucrat.
              </p>
            </div>
          </>
        )}
      </fieldset>
      {options.isPending && (
        <p role="status">Se verifică grupul și campaniile…</p>
      )}
      {options.isError && (
        <div role="alert">
          Nu am putut încărca opțiunile.{' '}
          <Button variant="outline" onClick={() => void options.refetch()}>
            Reîncearcă
          </Button>
        </div>
      )}
      <FieldError>{form.formError}</FieldError>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={!changed || pending || options.isPending || options.isError}
        >
          Salvează modificările
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Înapoi
        </Button>
      </div>
      <Dialog
        open={confirming !== null && confirming.consequences.length > 0}
        onOpenChange={(next) => {
          if (!next && !mutation.isPending) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmă modificarea</DialogTitle>
            <DialogDescription>
              Salvarea are următoarele consecințe:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5">
            {confirming?.consequences.map((consequence) => (
              <li key={`${consequence.kind}:${consequence.memberId}`}>
                {consequenceText(consequence)}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setConfirming(null)}
            >
              Renunță
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => void confirm()}
            >
              {mutation.isPending ? 'Se salvează…' : 'Confirmă și salvează'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
