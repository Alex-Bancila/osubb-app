import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from 'react';
import { Pencil } from 'lucide-react';
import { AttachedLinksFields } from '../../components/attached-link/AttachedLinksFields';
import { FormattedTextField } from '../../components/formatted-text/FormattedTextField';
import {
  attachedLinksFrom,
  sameAttachedLinks,
} from '../../lib/schemas/attached-link';
import { Button } from '../../components/ui/button';
import { DateTimePicker } from '../../components/ui/date-picker';
import { FieldError } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
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
import { reasonCopy } from '../../lib/command-reasons';
import {
  TaskEditError,
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
  AssignmentModeField,
  AudienceField,
  MinimumLevelField,
} from './TaskModeFields';
import { useMemberLevel } from '../../lib/auth';
import {
  minimumLevelText,
  taskMinimumLevelChoices,
} from '../../lib/minimum-level';
import {
  campaignsFor,
  groupLookup,
  isPrivateGroup,
  type ManagedWorkGroup,
  type TaskFormOptions,
} from './task-form-model';
import { useReceiptTurn } from './receipt-turn';

const SAVE_FAILED = 'Nu am putut salva modificările. Reîncearcă.';
const CAMPAIGN_INFO =
  'O etichetă pentru raportare: punctele obținute și cine a lucrat.';

/** ADR-0007 (amended 2026-09-21): every field is editable until review. */
function isEditable(status: TaskPresentationRow['status']) {
  return status === 'todo' || status === 'in_progress';
}

/**
 * "Editează": the Task's fields in a form sheet over its details. After a
 * save the receipt takes focus; otherwise focus returns to the button.
 */
export function TaskEditControl({
  task,
  canManage,
}: {
  task: TaskPresentationRow;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  // Each opening starts from the Task as it is now; 0 until the first one.
  const [attempt, setAttempt] = useState(0);
  // #1132: the row the form is seeded from, fixed at opening. The details
  // query is refetched by live changes while the sheet is open; the form
  // never sees that, so nothing the Manager did not type is sent, and the
  // version it sends back is the one it showed. A fresh seed is taken only
  // when the server says the Task moved on and the Manager asks for it.
  const [seed, setSeed] = useState<TaskPresentationRow>(task);
  // Only the latest receipt in the sheet shows (Audit D-16).
  const turn = useReceiptTurn();
  const receipt = useRef<HTMLParagraphElement>(null);
  const justSaved = useRef(false);
  useEffect(() => {
    if (saved) receipt.current?.focus();
  }, [saved]);
  const canEdit = canManage && isEditable(task.status);
  // Nothing to offer: no empty item in the sheet's action row.
  if (!canEdit && !saved) return null;
  return (
    <section aria-label="Editarea taskului" className="space-y-3">
      {saved && turn.current && (
        <p ref={receipt} role="status" tabIndex={-1}>
          Modificările au fost salvate și înregistrate în istoricul taskului.
        </p>
      )}
      {canEdit && (
        // The sheet's one primary action; "taskul" stays in its name.
        <Button
          onClick={() => {
            justSaved.current = false;
            setSeed(task);
            setAttempt((current) => current + 1);
            setOpen(true);
            setSaved(false);
          }}
        >
          <Pencil aria-hidden="true" />
          Editează <span className="sr-only">taskul</span>
        </Button>
      )}
      {canEdit && attempt > 0 && (
        <TaskEditForm
          key={attempt}
          task={seed}
          open={open}
          finalFocus={() =>
            justSaved.current ? (receipt.current ?? false) : true
          }
          onClose={() => setOpen(false)}
          onReseed={() => {
            setSeed(task);
            setAttempt((current) => current + 1);
          }}
          onSaved={() => {
            justSaved.current = true;
            setOpen(false);
            setSaved(true);
            turn.claim();
          }}
        />
      )}
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
  open,
  finalFocus,
  onClose,
  onSaved,
  onReseed,
}: {
  /** The seed: the row as it was when the sheet opened, never the live one. */
  task: TaskPresentationRow;
  open: boolean;
  finalFocus: ComponentProps<typeof FormSheet>['finalFocus'];
  onClose: () => void;
  onSaved: () => void;
  /** Start again from the live row (#1132), after a stale save. */
  onReseed: () => void;
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
  const [assignmentMode, setAssignmentMode] = useState<'direct' | 'public'>(
    task.assignment_mode === 'public' ? 'public' : 'direct',
  );
  const [audience, setAudience] = useState<'local' | 'org'>(
    task.audience === 'org' ? 'org' : 'local',
  );
  const [groupId, setGroupId] = useState(task.group_id);
  // R57: the Task's Cine îl vede. A row that does not carry it (an older
  // cache) neither shows nor sends it, so an edit never lowers it by accident.
  const actorLevel = useMemberLevel();
  const storedRole: number | null =
    typeof task.min_level === 'number' ? task.min_level : null;
  const [minLevel, setMinLevel] = useState(storedRole ?? 0);
  // Until the manager picks a Role, the edit keeps the stored one exactly:
  // a Task stored below its Group's floor (every Task before R57) is not
  // "changed" by opening the form (final review of R57).
  const [roleTouched, setRoleTouched] = useState(false);
  const [initialLinks] = useState(() => attachedLinksFrom(task.links));
  const [links, setLinks] = useState(initialLinks);
  const locked = groupLock(task);
  const [checking, setChecking] = useState(false);
  // #1132: the server refused the save because the Task moved on since the
  // seed; only a fresh seed (or Renunță) leads anywhere from here.
  const [stale, setStale] = useState(false);
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
  const roleChoices = taskMinimumLevelChoices(
    group,
    localOnly ? 'local' : audience,
    actorLevel,
  );
  // Only someone at or above a Role changes it (the Moderator's 9 excepted).
  const lockedRole =
    storedRole !== null && actorLevel < 9 && storedRole > actorLevel
      ? minimumLevelText(storedRole)
      : undefined;
  const sentRole: number | null = umbrella
    ? null
    : assignmentMode === 'direct'
      ? 0
      : storedRole === null
        ? null
        : lockedRole || !roleTouched
          ? storedRole
          : roleChoices.some((rung) => rung.level === minLevel)
            ? minLevel
            : (roleChoices[0]?.level ?? 0);
  // What the field shows: the Role the Task reaches at (a stored value below
  // the offered list reads as the lowest choice, which is what gates it).
  const shownRole =
    sentRole !== null && roleChoices.some((rung) => rung.level === sentRole)
      ? sentRole
      : (roleChoices[0]?.level ?? sentRole ?? 0);
  const values: TaskUpdateValues = {
    groupId,
    title,
    description,
    deadline: instantFor(deadline),
    campaignId: umbrella ? null : campaignId,
    assignmentMode: umbrella ? null : assignmentMode,
    // A direct Task is local only (R26), like a Private Group's; `audience`
    // keeps the choice for when the mode goes back to Public.
    audience: umbrella
      ? null
      : assignmentMode === 'direct' || localOnly
        ? 'local'
        : audience,
    links,
    minLevel: sentRole,
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
    !sameAttachedLinks(links, initialLinks) ||
    title.trim() !== task.title ||
    (description.trim() || null) !== (task.description ?? null) ||
    deadline !== initialDeadline ||
    (!umbrella &&
      (campaignId !== task.campaign_id ||
        values.assignmentMode !== task.assignment_mode ||
        values.audience !== task.audience ||
        (values.minLevel !== null && values.minLevel !== (storedRole ?? 0))));

  /** A refused save: a stale seed asks for a fresh one, anything else is
   *  put under its field or in the form-level slot. */
  function refuse(failure: unknown) {
    if (failure instanceof TaskEditError && failure.reason === 'task_changed') {
      setConfirming(null);
      setStale(true);
      return;
    }
    form.fail(failure, SAVE_FAILED);
  }

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
    // update_task is a full-state replace: the links as the form shows them,
    // and the version of the seed (#1132), so a save over someone else's
    // change is refused rather than applied.
    const input: TaskUpdateInput = {
      taskId: task.id,
      ...parsed,
      updatedAt: task.updated_at ?? null,
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
      refuse(failure);
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
      refuse(failure);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Editează taskul"
      busy={pending}
      finalFocus={finalFocus}
      className="sm:max-w-2xl"
    >
      <form
        onSubmit={submit}
        className="flex flex-1 flex-col gap-5"
        aria-label="Editează taskul"
        noValidate
      >
        <fieldset disabled={pending} className="grid min-w-0 gap-5">
          <legend className="sr-only">Câmpurile taskului</legend>
          {options.data && (
            <div className="grid gap-1.5" {...form.slot('groupId')}>
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
                  className="m-0 text-sm text-muted-foreground"
                >
                  {locked}
                </p>
              ) : (
                groupId !== task.group_id && (
                  <p className="m-0 text-sm text-muted-foreground">
                    Înainte de salvare vezi ce se schimbă pentru executor,
                    candidați și campanie.
                  </p>
                )
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-title`} className="text-sm font-medium">
              Titlu
            </label>
            <Input
              id={`${id}-title`}
              required
              aria-required="true"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              {...form.field('title')}
            />
            <FieldError {...form.errorProps('title')} />
          </div>
          <div className="grid gap-1.5">
            <label
              id={`${id}-description-label`}
              htmlFor={`${id}-description`}
              className="text-sm font-medium"
            >
              Descriere (opțional)
            </label>
            <FormattedTextField
              id={`${id}-description`}
              labelId={`${id}-description-label`}
              name="description"
              value={description}
              onChange={setDescription}
              {...form.field('description')}
            />
            <FieldError {...form.errorProps('description')} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
              Termen{umbrella ? ' (opțional)' : ''} — ora României
            </label>
            <DateTimePicker
              id={`${id}-deadline`}
              required={!umbrella}
              defaultTime="23:59"
              value={deadline}
              onChange={setDeadline}
              {...form.field('deadline')}
            />
            <FieldError {...form.errorProps('deadline')} />
          </div>
          {!umbrella && (
            <>
              <AssignmentModeField
                id={id}
                value={assignmentMode}
                onChange={setAssignmentMode}
                form={form}
                directLockedBy={
                  assignmentMode === 'public' ? lockedRole : undefined
                }
              />
              {/* Hidden while Direct (R26): switching to Public is how a
                  direct Task is opened, starting from its stored Audience. */}
              {assignmentMode === 'public' && (
                <AudienceField
                  id={id}
                  value={audience}
                  localOnly={localOnly}
                  onChange={setAudience}
                  form={form}
                />
              )}
              {assignmentMode === 'public' && storedRole !== null && (
                <MinimumLevelField
                  id={id}
                  value={shownRole}
                  choices={roleChoices}
                  locked={lockedRole}
                  onChange={(level) => {
                    setRoleTouched(true);
                    setMinLevel(level);
                  }}
                  form={form}
                />
              )}
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`${id}-campaign`}
                    className="text-sm font-medium"
                  >
                    Campanie (opțional)
                  </label>
                  <InfoHint label="Despre campanie" id={`${id}-campaign-hint`}>
                    {CAMPAIGN_INFO}
                  </InfoHint>
                </div>
                <Select
                  id={`${id}-campaign`}
                  value={String(campaignId ?? '')}
                  options={[
                    { value: '', label: 'Fără campanie' },
                    ...(task.campaign_id !== null &&
                    !campaigns.some((row) => row.id === task.campaign_id)
                      ? [
                          {
                            value: String(task.campaign_id),
                            label: `${task.campaign?.name ?? 'Campania existentă'} (actuală)`,
                          },
                        ]
                      : []),
                    ...campaigns.map((row) => ({
                      value: String(row.id),
                      label: row.name,
                    })),
                  ]}
                  onValueChange={(next) =>
                    setCampaignId(next ? Number(next) : null)
                  }
                  {...form.field('campaignId', `${id}-campaign-hint`)}
                />
                <FieldError {...form.errorProps('campaignId')} />
              </div>
            </>
          )}
          <AttachedLinksFields
            value={links}
            onChange={setLinks}
            form={form}
            name="links"
          />
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
        {stale ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-destructive"
          >
            <span>{reasonCopy('task_changed')}</span>
            <Button type="button" variant="outline" onClick={onReseed}>
              Reîncarcă formularul
            </Button>
          </div>
        ) : (
          <FieldError>{form.formError}</FieldError>
        )}
        <FormSheetFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Renunță
          </Button>
          <Button
            type="submit"
            disabled={
              !changed ||
              stale ||
              pending ||
              options.isPending ||
              options.isError
            }
          >
            Salvează modificările
          </Button>
        </FormSheetFooter>
      </form>
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
    </FormSheet>
  );
}
