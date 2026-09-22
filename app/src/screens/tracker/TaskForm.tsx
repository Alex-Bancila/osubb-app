import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  GroupOption,
  groupOptionLabel,
} from '../../components/ui/combobox';
import {
  RadioCard,
  RadioGroup,
  RadioGroupItem,
} from '../../components/ui/radio-group';
import { DirectExecutorSelector } from './DirectExecutorSelector';
import {
  campaignsFor,
  groupLookup,
  groupOptions,
  originFor,
  taskDraft,
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

/** Draft-only form; its caller owns the eventual atomic create command. */
export function TaskForm({
  options,
  onDraft,
  parentTaskId = null,
  allowSubtask = true,
  heading = 'Pregătește un task',
  submitLabel = 'Continuă',
}: {
  options: TaskFormOptions;
  onDraft: (draft: TaskDraft) => void;
  parentTaskId?: number | null;
  /** False where a Subtask cannot be started (it is created from its Umbrella). */
  allowSubtask?: boolean;
  /** Null when a surrounding Dialog already names the form. */
  heading?: string | null;
  submitLabel?: string;
}) {
  const id = useId();
  const [values, setValues] = useState<TaskFormValues>({
    title: '',
    description: '',
    deadline: '',
    groupId: null,
    kind: parentTaskId ? 'subtask' : 'task',
    parentTaskId,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: null,
    campaignId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const groupsById = useMemo(() => groupLookup(options), [options]);
  const groups = useMemo(() => groupOptions(options.groups), [options.groups]);
  const origin = originFor(values, options);
  const campaigns = campaignsFor(origin, options);
  const parents = umbrellasFor(origin?.id ?? null, options);
  const parent =
    options.umbrellas.find((umbrella) => umbrella.id === values.parentTaskId) ??
    null;
  const umbrella = values.kind === 'umbrella';
  const subtask = values.kind === 'subtask';
  const lockedToParent = parentTaskId !== null;
  const control =
    'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  function update(patch: Partial<TaskFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setError(null);
  }
  function chooseGroup(group: ManagedWorkGroup | null) {
    const groupId = group?.id ?? null;
    update({
      groupId,
      // Choices that belong to another Group no longer apply.
      campaignId: null,
      executorId: null,
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
  function submit(event: FormEvent) {
    event.preventDefault();
    const draft = taskDraft(values, options);
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    setError(null);
    onDraft(draft);
  }
  if (!options.groups.length)
    return <p>Nu ai grupuri în care poți pregăti taskuri.</p>;
  const groupLabel = (group: ManagedWorkGroup) =>
    groupOptionLabel(group, groupsById);
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
      <div className="grid gap-2">
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
      </div>
      <div className="grid gap-1.5">
        <span id={`${id}-group`} className="text-sm font-medium">
          Grup de origine (obligatoriu)
        </span>
        <Combobox<ManagedWorkGroup>
          items={groups}
          value={origin ?? null}
          onValueChange={chooseGroup}
          itemToStringLabel={groupLabel}
          isItemEqualToValue={(a, b) => a.id === b.id}
          disabled={lockedToParent}
        >
          <ComboboxTrigger aria-labelledby={`${id}-group`}>
            <ComboboxValue placeholder="Alege un grup">
              {(group: ManagedWorkGroup | null) =>
                group ? (
                  <GroupOption group={group} groupsById={groupsById} />
                ) : (
                  'Alege un grup'
                )
              }
            </ComboboxValue>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              aria-label="Caută un grup"
              placeholder="Caută un grup"
            />
            <ComboboxEmpty />
            <ComboboxList>
              {(group: ManagedWorkGroup) => (
                <ComboboxItem key={group.id} value={group}>
                  <GroupOption group={group} groupsById={groupsById} />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {subtask && (
          <p className="text-sm text-muted-foreground">
            Un subtask rămâne în grupul taskului-umbrelă.
          </p>
        )}
      </div>
      {subtask && (
        <div className="grid gap-1.5">
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
        />
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
        />
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
        />
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
            >
              <option value="direct">Direct</option>
              <option value="public">
                Public — înscriere prin lista de candidați
              </option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-audience`} className="text-sm font-medium">
              Audiență
            </label>
            <select
              id={`${id}-audience`}
              className={control}
              value={values.audience}
              onChange={(event) =>
                update({
                  audience: event.target.value === 'org' ? 'org' : 'local',
                })
              }
            >
              <option value="local">Membrii grupului de origine</option>
              <option value="org">Toți membrii eligibili OSUBB</option>
            </select>
            <p className="text-sm text-muted-foreground">
              Cine se poate înscrie când taskul este public.
            </p>
          </div>
          {values.assignmentMode === 'direct' && origin && (
            <div className="grid gap-1.5">
              <DirectExecutorSelector
                originGroupId={origin.id}
                value={values.executorId}
                onChange={(executorId) => update({ executorId })}
              />
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
              aria-describedby={`${id}-campaign-hint`}
              onChange={(event) =>
                update({
                  campaignId: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            >
              <option value="">Fără campanie</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="min-h-11" type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}
