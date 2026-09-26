import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
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
import { TaskGroupCascade } from './TaskGroupCascade';
import {
  AUDIENCE_HINT,
  AUDIENCE_LABELS,
  campaignsFor,
  groupLookup,
  isPrivateGroup,
  PRIVATE_GROUP_AUDIENCE_HINT,
  type ManagedWorkGroup,
  type TaskFormOptions,
} from './task-form-model';

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

/**
 * One line per consequence `preview_task_update` lists (#627), naming the
 * member. A kind this screen does not know is still listed, in words that
 * make the manager check before confirming, so nothing is accepted unseen.
 */
function consequenceText(consequence: TaskUpdateConsequence) {
  const name = consequence.memberName;
  switch (consequence.kind) {
    case 'executor_added_to_group':
      return `${name} devine membru al grupului nou.`;
    case 'executor_removed':
      return `${name} nu mai este executor. Taskul revine la „De făcut”.`;
    case 'candidate_removed':
      return `${name} iese din lista de candidați.`;
    case 'campaign_cleared':
      return 'Campania se șterge: nu poate eticheta taskuri în grupul nou.';
    default:
      return consequence.memberId === null
        ? 'Salvarea mai are o consecință pe care aplicația nu o poate descrie încă.'
        : `Participarea lui ${name} la task se schimbă.`;
  }
}

/** Why the Group cannot change here, or null when it can (#627). */
function groupLock(task: TaskPresentationRow) {
  if (task.parent_task_id !== null)
    return 'Un subtask rămâne în grupul taskului-umbrelă.';
  if (task.kind === 'umbrella' && (task.subtasks?.length ?? 0) > 0)
    return 'Un task-umbrelă cu subtaskuri nu își poate schimba grupul.';
  return null;
}

/** The Campaigns the chosen Group may carry, plus the Task's own. */
function campaignIdsFor(
  groupId: number,
  task: TaskPresentationRow,
  options: TaskFormOptions | undefined,
) {
  const group = options?.groups.find((row) => row.id === groupId);
  return [
    ...(options ? campaignsFor(group, options) : []).map((row) => row.id),
    ...(task.campaign_id === null ? [] : [task.campaign_id]),
  ];
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
  const [groupId, setGroupId] = useState(task.group_id);
  const [link, setLink] = useState({
    label: task.link_label ?? '',
    url: task.link_url ?? '',
  });
  const locked = groupLock(task);
  const [checking, setChecking] = useState(false);
  // The values waiting for the manager to accept their consequences.
  const [confirming, setConfirming] = useState<{
    input: TaskUpdateInput;
    consequences: TaskUpdateConsequence[];
  } | null>(null);
  const submitting = useRef(false);
  const group = options.data?.groups.find((row) => row.id === groupId);
  const campaigns = options.data ? campaignsFor(group, options.data) : [];
  // A Private Group's Tasks are local only (#757): the form shows and sends
  // that, whatever the Task carried before.
  const localOnly = options.data
    ? isPrivateGroup(groupId, options.data)
    : false;
  const groupsById = useMemo(
    () => (options.data ? groupLookup(options.data) : new Map()),
    [options.data],
  );
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
    groupId,
    title,
    description,
    deadline: instantFor(deadline),
    campaignId: umbrella ? null : campaignId,
    assignmentMode: umbrella
      ? null
      : (assignmentMode as TaskUpdateValues['assignmentMode']),
    // A direct Task is local only (R26), like a Private Group's; `audience`
    // keeps the choice for when the mode goes back to Public.
    audience: umbrella
      ? null
      : assignmentMode === 'direct' || localOnly
        ? 'local'
        : (audience as TaskUpdateValues['audience']),
    link,
  };
  const form = useFormValidation(
    taskUpdateSchema({
      umbrella,
      campaignIds: campaignIdsFor(groupId, task, options.data),
    }),
    values,
    fieldForReason,
  );
  const changed =
    groupId !== task.group_id ||
    (link.label.trim() || null) !== task.link_label ||
    (link.url.trim() || null) !== task.link_url ||
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

  function chooseGroup(next: ManagedWorkGroup) {
    setGroupId(next.id);
    // A Campaign picked here that cannot tag the new Group goes. The Task's
    // own Campaign stays selected: if it cannot follow, the server clears it
    // and the confirmation says so (campaign_cleared).
    if (
      campaignId !== null &&
      campaignId !== task.campaign_id &&
      options.data &&
      !campaignsFor(next, options.data).some((row) => row.id === campaignId)
    )
      setCampaignId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = form.validate();
    if (!parsed) return;
    const { link: parsedLink, ...fields } = parsed;
    const input: TaskUpdateInput = {
      taskId: task.id,
      ...fields,
      // update_task is a full-state replace: the link as the form shows it.
      linkLabel: parsedLink.label,
      linkUrl: parsedLink.url,
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
      // The same rules against the fresh read: a Campaign or the chosen
      // Group may have gone.
      const recheck = taskUpdateSchema({
        umbrella,
        campaignIds: campaignIdsFor(groupId, task, fresh.data),
        groupIds: fresh.data.groups.map((row) => row.id),
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
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <legend className="sr-only">Câmpurile taskului</legend>
        {options.data && (
          <div className="space-y-1" {...form.slot('groupId')}>
            <TaskGroupCascade
              groups={options.data.groups}
              groupsById={groupsById}
              value={groupId}
              onChange={chooseGroup}
              disabled={locked !== null}
              describedBy={
                [
                  locked ? `${id}-group-lock` : undefined,
                  form.error('groupId') ? form.errorId('groupId') : undefined,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              invalid={form.error('groupId') !== undefined}
            />
            <FieldError {...form.errorProps('groupId')} />
            {locked ? (
              <p
                id={`${id}-group-lock`}
                className="text-sm text-muted-foreground"
              >
                {locked}
              </p>
            ) : (
              groupId !== task.group_id && (
                <p className="text-sm text-muted-foreground">
                  Înainte de salvare vezi ce se schimbă pentru executor,
                  candidați și campanie.
                </p>
              )
            )}
          </div>
        )}
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
            {/* Hidden while Direct (R26): switching to Public is how a
                direct Task is opened, starting from its stored Audience. */}
            {assignmentMode === 'public' && (
              <div className="space-y-1">
                <label className="block space-y-1">
                  <span>Audiență</span>
                  <select
                    className={control}
                    value={localOnly ? 'local' : audience}
                    onChange={(event) => setAudience(event.target.value)}
                    {...form.field('audience', `${id}-audience-hint`)}
                  >
                    <option value="local">{AUDIENCE_LABELS.local}</option>
                    <option value="org" disabled={localOnly}>
                      {AUDIENCE_LABELS.org}
                    </option>
                  </select>
                </label>
                <FieldError {...form.errorProps('audience')} />
                <p
                  id={`${id}-audience-hint`}
                  className="text-sm text-muted-foreground"
                >
                  {localOnly ? PRIVATE_GROUP_AUDIENCE_HINT : AUDIENCE_HINT}
                </p>
              </div>
            )}
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
        <fieldset className="min-w-0 space-y-3 border-t border-border pt-3">
          <legend className="font-medium">Link atașat (opțional)</legend>
          <AttachedLinkFields
            value={link}
            onChange={setLink}
            form={form}
            name="link"
          />
        </fieldset>
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
