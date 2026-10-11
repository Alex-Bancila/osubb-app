import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AttachedLinksFields } from '../../components/attached-link/AttachedLinksFields';
import { Button } from '../../components/ui/button';
import { DateTimePicker } from '../../components/ui/date-picker';
import { FormSheetFooter } from '../../components/ui/form-sheet';
import { Input, Textarea } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { FieldError } from '../../components/ui/field';
import { InfoHint } from '../../components/ui/info-hint';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '../../components/ui/combobox';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { AssignmentModeField, AudienceField } from './TaskModeFields';
import {
  MAX_TASK_COPIES,
  fieldForReason,
  taskDraftSchema,
} from '../../lib/schemas/task';
import { useFormValidation } from '../../lib/use-form-validation';
import { DirectExecutorSelector } from './DirectExecutorSelector';
import { TaskGroupCascade } from './TaskGroupCascade';
import {
  campaignsFor,
  groupLookup,
  isPrivateGroup,
  originFor,
  rootGroups,
  taskDraftInput,
  umbrellasFor,
  type ManagedWorkGroup,
  type TaskDraft,
  type TaskFormOptions,
  type TaskFormValues,
} from './task-form-model';

type Umbrella = TaskFormOptions['umbrellas'][number];

/** The kinds, by name alone; `KINDS_INFO` explains them behind the "i". */
const KINDS: { value: TaskFormValues['kind']; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'umbrella', label: 'Task-umbrelă' },
  { value: 'subtask', label: 'Subtask' },
];

const KINDS_INFO =
  'Un task este o sarcină cu un singur executor. Un task-umbrelă este un task părinte care grupează subtaskuri: nu are executor propriu și se încheie când toate subtaskurile sunt gata. Un subtask este o parte dintr-un task-umbrelă existent, în același grup.';

const CAMPAIGN_INFO =
  'O etichetă pentru raportare: campania arată punctele obținute și cine a lucrat. Nu schimbă cine poate lucra la task.';

const COPIES_INFO =
  'Creează mai multe taskuri identice odată, până la 100. Pentru un task direct alegi câte un executor pentru fiecare exemplar la pasul următor.';

/**
 * Draft-only form; its caller owns the eventual atomic create command. When
 * that command refuses, `onDraft` rejects and the reason lands under the
 * field it belongs to (ruling R8).
 *
 * Only an optional field says so in its label; a required one is marked for
 * assistive technology (`required`, `aria-required`) and by validation.
 *
 * It is a form sheet's content: it grows to the sheet's height and ends with
 * the pinned footer (Renunță, then the submit button). `status` is a line the
 * caller needs just above that footer while it works.
 */
export function TaskForm({
  options,
  onDraft,
  parentTaskId = null,
  allowSubtask = true,
  heading = 'Pregătește un task',
  submitLabel = 'Continuă',
  onCancel,
  cancelLabel = 'Renunță',
  status,
  plural = 'taskuri',
}: {
  options: TaskFormOptions;
  onDraft: (draft: TaskDraft) => void | Promise<void>;
  parentTaskId?: number | null;
  /** False where a Subtask cannot be started (it is created from its Umbrella). */
  allowSubtask?: boolean;
  /** Null when a surrounding Dialog already names the form. */
  heading?: string | null;
  submitLabel?: string;
  /** Adds the secondary action to the footer, left of the submit button. */
  onCancel?: () => void;
  cancelLabel?: string;
  status?: ReactNode;
  /** The noun the button counts: "subtaskuri" under an Umbrella. */
  plural?: 'taskuri' | 'subtaskuri';
}) {
  const id = useId();
  const [values, setValues] = useState<TaskFormValues>(() => {
    // One root and nothing else to choose between: start there.
    const roots = rootGroups(options.groups);
    return {
      title: '',
      description: '',
      deadline: '',
      groupId: roots.length === 1 && roots[0] ? roots[0].id : null,
      kind: parentTaskId ? 'subtask' : 'task',
      parentTaskId,
      audience: 'local',
      assignmentMode: 'direct',
      executorId: null,
      campaignId: null,
      links: [],
      copies: '1',
    };
  });
  const schema = useMemo(() => taskDraftSchema(options), [options]);
  const form = useFormValidation(
    schema,
    taskDraftInput(values, options),
    fieldForReason,
  );
  const groupsById = useMemo(() => groupLookup(options), [options]);
  const origin = originFor(values, options);
  const campaigns = campaignsFor(origin, options);
  const parents = umbrellasFor(origin?.id ?? null, options);
  const parent =
    options.umbrellas.find((umbrella) => umbrella.id === values.parentTaskId) ??
    null;
  const localOnly = isPrivateGroup(origin?.id, options);
  const umbrella = values.kind === 'umbrella';
  const subtask = values.kind === 'subtask';
  const lockedToParent = parentTaskId !== null;
  const copies = Number(values.copies);
  // Above one copy the Executors are chosen at the next step, one per copy.
  const manyCopies = Number.isInteger(copies) && copies > 1;
  const label =
    !umbrella && manyCopies
      ? values.assignmentMode === 'direct'
        ? 'Continuă'
        : `Creează ${copies} ${plural}`
      : submitLabel;
  function update(patch: Partial<TaskFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }
  function chooseGroup(group: ManagedWorkGroup) {
    const groupId = group.id;
    const campaignStays = campaignsFor(group, options).some(
      (campaign) => campaign.id === values.campaignId,
    );
    update({
      groupId,
      // Choices that belong to another Group no longer apply; a Campaign
      // that can still tag the new Group stays.
      campaignId: campaignStays ? values.campaignId : null,
      executorId: group.id === origin?.id ? values.executorId : null,
      parentTaskId: parent && parent.group_id === groupId ? parent.id : null,
    });
  }
  function chooseParent(next: Umbrella | null) {
    update({
      parentTaskId: next?.id ?? null,
      groupId: next?.group_id ?? values.groupId,
      campaignId: next?.group_id === origin?.id ? values.campaignId : null,
      executorId: next?.group_id === origin?.id ? values.executorId : null,
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = form.validate();
    if (!draft) return;
    try {
      await onDraft(draft);
    } catch (failure) {
      form.fail(failure, 'Nu am putut pregăti taskul. Încearcă din nou.');
    }
  }
  if (!options.groups.length)
    return <p>Nu ai grupuri în care poți pregăti taskuri.</p>;
  const parentGroupName = (item: Umbrella) =>
    groupsById.get(item.group_id)?.name;
  const kinds = KINDS.filter(
    (kind) => kind.value !== 'subtask' || allowSubtask || lockedToParent,
  );
  return (
    <form
      aria-label={heading ?? 'Pregătește un task'}
      onSubmit={submit}
      noValidate
      className="flex flex-1 flex-col gap-5"
    >
      {heading && (
        <h2 className="m-0 text-(length:--fs-lg) leading-snug font-bold">
          {heading}
        </h2>
      )}
      <div className="grid gap-2" {...form.slot('kind')}>
        <div className="flex items-center justify-between gap-2">
          <span id={`${id}-kind`} className="text-sm font-medium">
            Ce fel de task?
          </span>
          <InfoHint label="Despre felurile de task" id={`${id}-kind-info`}>
            {KINDS_INFO}
          </InfoHint>
        </div>
        <SegmentedRadio
          aria-labelledby={`${id}-kind`}
          aria-describedby={`${id}-kind-info`}
          options={kinds}
          value={values.kind}
          disabled={lockedToParent}
          onValueChange={(kind) =>
            update({
              kind,
              parentTaskId: null,
              campaignId: null,
              executorId: null,
            })
          }
        />
        <FieldError {...form.errorProps('kind')} />
      </div>
      <div className="grid gap-1.5" {...form.slot('groupId')}>
        <TaskGroupCascade
          groups={options.groups}
          groupsById={groupsById}
          value={origin?.id ?? values.groupId}
          onChange={chooseGroup}
          disabled={lockedToParent}
          describedBy={
            form.error('groupId') ? form.errorId('groupId') : undefined
          }
          invalid={form.error('groupId') !== undefined}
        />
        <FieldError {...form.errorProps('groupId')} />
        {subtask && (
          <p className="text-sm text-muted-foreground">
            Un subtask rămâne în grupul taskului-umbrelă.
          </p>
        )}
      </div>
      {subtask && (
        <div className="grid gap-1.5" {...form.slot('parentTaskId')}>
          <span id={`${id}-parent`} className="text-sm font-medium">
            Task-umbrelă
          </span>
          <Combobox<Umbrella>
            items={parents}
            value={parent}
            onValueChange={chooseParent}
            itemToStringLabel={(item) => item.title}
            isItemEqualToValue={(a, b) => a.id === b.id}
            disabled={lockedToParent || !parents.length}
          >
            <ComboboxTrigger
              aria-labelledby={`${id}-parent`}
              aria-required="true"
            >
              <ComboboxValue placeholder="Alege taskul-umbrelă">
                {(item: Umbrella | null) =>
                  item ? item.title : 'Alege taskul-umbrelă'
                }
              </ComboboxValue>
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput
                aria-label="Caută un task-umbrelă"
                placeholder="Caută după titlu"
              />
              <ComboboxEmpty />
              <ComboboxList>
                {(item: Umbrella) => (
                  <ComboboxItem key={item.id} value={item}>
                    <span className="flex min-w-0 items-baseline gap-1">
                      <span className="truncate">{item.title}</span>
                      {!origin && parentGroupName(item) && (
                        <span className="truncate text-xs text-muted-foreground">
                          <span aria-hidden="true">· </span>
                          {parentGroupName(item)}
                        </span>
                      )}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldError {...form.errorProps('parentTaskId')} />
          {!parents.length && (
            <p className="text-sm text-muted-foreground">
              {origin
                ? 'Grupul ales nu are taskuri-umbrelă deschise.'
                : 'Nu există taskuri-umbrelă deschise.'}
            </p>
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
          value={values.title}
          onChange={(event) => update({ title: event.target.value })}
          {...form.field('title')}
        />
        <FieldError {...form.errorProps('title')} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-description`} className="text-sm font-medium">
          Descriere (opțional)
        </label>
        <Textarea
          id={`${id}-description`}
          rows={4}
          value={values.description}
          onChange={(event) => update({ description: event.target.value })}
          {...form.field('description')}
        />
        <FieldError {...form.errorProps('description')} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
          {/* The one place the time zone is said: where a time is typed. */}
          Termen{umbrella ? ' (opțional)' : ''} — ora României
        </label>
        <DateTimePicker
          id={`${id}-deadline`}
          required={!umbrella}
          defaultTime="23:59"
          value={values.deadline}
          onChange={(deadline) => update({ deadline })}
          {...form.field('deadline')}
        />
        <FieldError {...form.errorProps('deadline')} />
      </div>
      {!umbrella && (
        <>
          <AssignmentModeField
            id={id}
            value={values.assignmentMode}
            onChange={(assignmentMode) =>
              update({ assignmentMode, executorId: null })
            }
            form={form}
          />
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-copies`} className="text-sm font-medium">
                Exemplare
              </label>
              <InfoHint label="Despre exemplare" id={`${id}-copies-info`}>
                {COPIES_INFO}
              </InfoHint>
            </div>
            <Input
              id={`${id}-copies`}
              type="number"
              min="1"
              max={MAX_TASK_COPIES}
              step="1"
              inputMode="numeric"
              className="w-28"
              value={values.copies}
              onChange={(event) => update({ copies: event.target.value })}
              {...form.field('copies', `${id}-copies-info`)}
            />
            <FieldError {...form.errorProps('copies')} />
          </div>
          {/* A direct Task is local only (R26); `values.audience` keeps the
              choice for when the mode goes back to Public. */}
          {values.assignmentMode === 'public' && (
            <AudienceField
              id={id}
              value={values.audience}
              localOnly={localOnly}
              onChange={(audience) => update({ audience })}
              form={form}
            />
          )}
          {values.assignmentMode === 'direct' && origin && !manyCopies && (
            <div className="grid gap-1.5" {...form.slot('executorId')}>
              <DirectExecutorSelector
                originGroupId={origin.id}
                value={values.executorId}
                onChange={(executorId) => update({ executorId })}
              />
              <FieldError {...form.errorProps('executorId')} />
            </div>
          )}
          {values.assignmentMode === 'direct' && manyCopies && (
            <p
              className="text-sm text-muted-foreground"
              {...form.slot('executorId')}
            >
              Executorii se aleg la pasul următor, câte unul pentru fiecare
              exemplar.
            </p>
          )}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
                Campanie (opțional)
              </label>
              <InfoHint label="Despre campanie" id={`${id}-campaign-hint`}>
                {CAMPAIGN_INFO}
              </InfoHint>
            </div>
            <Select
              id={`${id}-campaign`}
              value={
                campaigns.some((campaign) => campaign.id === values.campaignId)
                  ? String(values.campaignId ?? '')
                  : ''
              }
              disabled={!origin || !campaigns.length}
              options={[
                { value: '', label: 'Fără campanie' },
                ...campaigns.map((campaign) => ({
                  value: String(campaign.id),
                  label: campaign.name,
                })),
              ]}
              onValueChange={(campaignId) =>
                update({ campaignId: campaignId ? Number(campaignId) : null })
              }
              {...form.field(
                'campaignId',
                origin && !campaigns.length
                  ? `${id}-campaign-empty`
                  : `${id}-campaign-hint`,
              )}
            />
            <FieldError {...form.errorProps('campaignId')} />
            {/* A state the manager must see stays visible; the explanation
                waits behind the "i". */}
            {origin && !campaigns.length && (
              <p
                id={`${id}-campaign-empty`}
                className="text-sm text-muted-foreground"
              >
                Grupul ales nu are campanii active.
              </p>
            )}
          </div>
        </>
      )}
      <AttachedLinksFields
        value={values.links}
        onChange={(links) => update({ links })}
        form={form}
        name="links"
      />
      <FieldError>{form.formError}</FieldError>
      {status}
      <FormSheetFooter>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit">{label}</Button>
      </FormSheetFooter>
    </form>
  );
}
