import { useId, useMemo, useState, type FormEvent } from 'react';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
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
import {
  RadioCard,
  RadioGroup,
  RadioGroupItem,
} from '../../components/ui/radio-group';
import { fieldForReason, taskDraftSchema } from '../../lib/schemas/task';
import { useFormValidation } from '../../lib/use-form-validation';
import { DirectExecutorSelector } from './DirectExecutorSelector';
import { TaskGroupCascade } from './TaskGroupCascade';
import {
  campaignsFor,
  groupLookup,
  isPrivateGroup,
  originFor,
  PRIVATE_GROUP_AUDIENCE_HINT,
  rootGroups,
  taskDraftInput,
  umbrellasFor,
  type ManagedWorkGroup,
  type TaskDraft,
  type TaskFormOptions,
  type TaskFormValues,
} from './task-form-model';

type Umbrella = TaskFormOptions['umbrellas'][number];

const KINDS: {
  value: TaskFormValues['kind'];
  label: string;
  hint: string;
}[] = [
  {
    value: 'task',
    label: 'Task',
    hint: 'O sarcină cu un singur executor.',
  },
  {
    value: 'umbrella',
    label: 'Task-umbrelă',
    hint: 'Un task părinte care grupează subtaskuri. Nu are executor propriu; se încheie când toate subtaskurile sunt gata.',
  },
  {
    value: 'subtask',
    label: 'Subtask',
    hint: 'O parte dintr-un task-umbrelă existent, în același grup.',
  },
];

/**
 * Draft-only form; its caller owns the eventual atomic create command. When
 * that command refuses, `onDraft` rejects and the reason lands under the
 * field it belongs to (ruling R8).
 */
export function TaskForm({
  options,
  onDraft,
  parentTaskId = null,
  allowSubtask = true,
  heading = 'Pregătește un task',
  submitLabel = 'Continuă',
}: {
  options: TaskFormOptions;
  onDraft: (draft: TaskDraft) => void | Promise<void>;
  parentTaskId?: number | null;
  /** False where a Subtask cannot be started (it is created from its Umbrella). */
  allowSubtask?: boolean;
  /** Null when a surrounding Dialog already names the form. */
  heading?: string | null;
  submitLabel?: string;
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
      link: { label: '', url: '' },
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
  const control =
    'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
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
  return (
    <form
      aria-label={heading ?? 'Pregătește un task'}
      onSubmit={submit}
      noValidate
      className="space-y-5"
    >
      {heading && <h2 className="text-xl font-semibold">{heading}</h2>}
      <div className="grid gap-2" {...form.slot('kind')}>
        <span id={`${id}-kind`} className="text-sm font-medium">
          Ce fel de task?
        </span>
        <RadioGroup
          aria-labelledby={`${id}-kind`}
          value={values.kind}
          disabled={lockedToParent}
          onValueChange={(kind: TaskFormValues['kind']) =>
            update({
              kind,
              parentTaskId: null,
              campaignId: null,
              executorId: null,
            })
          }
        >
          {KINDS.filter(
            (kind) =>
              kind.value !== 'subtask' || allowSubtask || lockedToParent,
          ).map((kind) => (
            <RadioCard key={kind.value} className="items-start">
              <RadioGroupItem
                value={kind.value}
                aria-labelledby={`${id}-kind-${kind.value}-label`}
                aria-describedby={`${id}-kind-${kind.value}`}
                className="mt-0.5"
              />
              <span className="grid gap-0.5">
                <span
                  id={`${id}-kind-${kind.value}-label`}
                  className="text-sm font-medium"
                >
                  {kind.label}
                </span>
                <span
                  id={`${id}-kind-${kind.value}`}
                  className="text-sm text-muted-foreground"
                >
                  {kind.hint}
                </span>
              </span>
            </RadioCard>
          ))}
        </RadioGroup>
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
            Task-umbrelă (obligatoriu)
          </span>
          <Combobox<Umbrella>
            items={parents}
            value={parent}
            onValueChange={chooseParent}
            itemToStringLabel={(item) => item.title}
            isItemEqualToValue={(a, b) => a.id === b.id}
            disabled={lockedToParent || !parents.length}
          >
            <ComboboxTrigger aria-labelledby={`${id}-parent`}>
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
      <div>
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Titlu (obligatoriu)
        </label>
        <input
          id={`${id}-title`}
          className={control}
          required
          value={values.title}
          onChange={(event) => update({ title: event.target.value })}
          {...form.field('title')}
        />
        <FieldError {...form.errorProps('title')} />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className="text-sm font-medium">
          Descriere
        </label>
        <textarea
          id={`${id}-description`}
          className={`${control} min-h-24`}
          rows={4}
          value={values.description}
          onChange={(event) => update({ description: event.target.value })}
          {...form.field('description')}
        />
        <FieldError {...form.errorProps('description')} />
      </div>
      <div>
        <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
          Termen{umbrella ? ' (opțional)' : ' (obligatoriu)'} — ora României
        </label>
        <input
          id={`${id}-deadline`}
          className={control}
          type="datetime-local"
          required={!umbrella}
          value={values.deadline}
          onChange={(event) => update({ deadline: event.target.value })}
          {...form.field('deadline')}
        />
        <FieldError {...form.errorProps('deadline')} />
      </div>
      {!umbrella && (
        <>
          <div>
            <label htmlFor={`${id}-mode`} className="text-sm font-medium">
              Mod de atribuire
            </label>
            <select
              id={`${id}-mode`}
              className={control}
              value={values.assignmentMode}
              onChange={(event) =>
                update({
                  assignmentMode:
                    event.target.value === 'public' ? 'public' : 'direct',
                  executorId: null,
                })
              }
              {...form.field('assignmentMode')}
            >
              <option value="direct">Direct</option>
              <option value="public">
                Public — înscriere prin lista de candidați
              </option>
            </select>
            <FieldError {...form.errorProps('assignmentMode')} />
          </div>
          <div>
            <label htmlFor={`${id}-audience`} className="text-sm font-medium">
              Audiență
            </label>
            <select
              id={`${id}-audience`}
              className={control}
              value={localOnly ? 'local' : values.audience}
              onChange={(event) =>
                update({
                  audience: event.target.value === 'org' ? 'org' : 'local',
                })
              }
              {...form.field('audience')}
            >
              <option value="local">Membrii grupului de origine</option>
              <option value="org" disabled={localOnly}>
                Toți membrii eligibili OSUBB
              </option>
            </select>
            <FieldError {...form.errorProps('audience')} />
            <p className="text-sm text-muted-foreground">
              {localOnly
                ? PRIVATE_GROUP_AUDIENCE_HINT
                : 'Cine se poate înscrie când taskul este public.'}
            </p>
          </div>
          {values.assignmentMode === 'direct' && origin && (
            <div className="grid gap-1.5" {...form.slot('executorId')}>
              <DirectExecutorSelector
                originGroupId={origin.id}
                value={values.executorId}
                onChange={(executorId) => update({ executorId })}
              />
              <FieldError {...form.errorProps('executorId')} />
              <p className="text-sm text-muted-foreground">
                Executorul poate fi ales acum sau mai târziu.
              </p>
            </div>
          )}
          <div className="grid gap-1.5 border-t border-border pt-4">
            <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
              Campanie (opțional)
            </label>
            <select
              id={`${id}-campaign`}
              className={control}
              value={
                campaigns.some((campaign) => campaign.id === values.campaignId)
                  ? (values.campaignId ?? '')
                  : ''
              }
              disabled={!origin || !campaigns.length}
              onChange={(event) =>
                update({
                  campaignId: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              {...form.field('campaignId', `${id}-campaign-hint`)}
            >
              <option value="">Fără campanie</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <FieldError {...form.errorProps('campaignId')} />
            <p
              id={`${id}-campaign-hint`}
              className="text-sm text-muted-foreground"
            >
              {origin && !campaigns.length
                ? 'Grupul ales nu are campanii active.'
                : 'O etichetă pentru raportare: campania arată punctele obținute și cine a lucrat. Nu schimbă cine poate lucra la task.'}
            </p>
          </div>
        </>
      )}
      <fieldset className="grid min-w-0 gap-3 border-t border-border pt-4">
        <legend className="text-sm font-medium">Link atașat (opțional)</legend>
        <AttachedLinkFields
          value={values.link}
          onChange={(link) => update({ link })}
          form={form}
          name="link"
        />
      </fieldset>
      <FieldError>{form.formError}</FieldError>
      <Button className="min-h-11" type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}
