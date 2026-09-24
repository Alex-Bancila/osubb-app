import { useId, useMemo, useState, type FormEvent } from 'react';
import { PlusIcon } from 'lucide-react';

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
  GroupOption,
  groupOptionLabel,
} from '../../components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../lib/auth';
import { eventSchema, fieldForReason } from '../../lib/schemas/event';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useCreateEvent,
  useEventFormOptions,
} from '../../queries/event-creation';
import {
  EVENT_TYPE_CHOICES,
  groupsAvailableAtLevel,
  minimumLevelChoices,
  type EventDraft,
  type EventFormGroup,
  type EventFormOptions,
  type EventFormValues,
} from './event-form-model';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const initialValues: EventFormValues = {
  title: '',
  type: 'sedinta',
  groupId: null,
  startsAt: '',
  endsAt: '',
  location: '',
  capacity: '',
  description: '',
  minLevel: 0,
};

/** Calendar's kind gate. The command remains the authorization boundary. */
export function NewEventControl() {
  const { claims } = useAuth();
  const options = useEventFormOptions();
  const actorLevel = claims?.member_level ?? 0;
  const available = useMemo(
    () =>
      options.data ? groupsAvailableAtLevel(options.data, actorLevel) : [],
    [actorLevel, options.data],
  );

  if (!claims || !options.data || available.length === 0) return null;
  return (
    <NewEventDialog
      options={{ ...options.data, groups: available }}
      actorLevel={actorLevel}
    />
  );
}

function NewEventDialog({
  options,
  actorLevel,
}: {
  options: EventFormOptions;
  actorLevel: number;
}) {
  const create = useCreateEvent();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        className="min-h-11 shrink-0"
        onClick={() => {
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      >
        <PlusIcon aria-hidden="true" />
        Eveniment nou
      </Button>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Eveniment nou</DialogTitle>
          <DialogDescription>
            Publică o întâlnire, activitate sau dată importantă într-un grup pe
            care îl gestionezi. Orele sunt interpretate în fusul României.
          </DialogDescription>
        </DialogHeader>
        <EventForm
          key={attempt}
          options={options}
          actorLevel={actorLevel}
          pending={create.isPending}
          onCancel={() => setOpen(false)}
          onCreate={async (draft) => {
            await create.mutateAsync(draft);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  options,
  actorLevel,
  pending,
  onCancel,
  onCreate,
}: {
  options: EventFormOptions;
  actorLevel: number;
  pending: boolean;
  onCancel: () => void;
  onCreate: (draft: EventDraft) => Promise<void>;
}) {
  const id = useId();
  const [values, setValues] = useState<EventFormValues>(initialValues);
  const schema = useMemo(
    () => eventSchema(options, actorLevel),
    [options, actorLevel],
  );
  const form = useFormValidation(schema, values, fieldForReason);
  const groupsById = useMemo(
    () => new Map(options.groupNames.map((group) => [group.id, group])),
    [options.groupNames],
  );
  const selectedGroup =
    options.groups.find((group) => group.id === values.groupId) ?? null;
  const levelChoices = minimumLevelChoices(
    selectedGroup?.minLevel ?? 0,
    actorLevel,
  );

  function update(patch: Partial<EventFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function chooseGroup(group: EventFormGroup | null) {
    const choices = group
      ? minimumLevelChoices(group.minLevel, actorLevel)
      : minimumLevelChoices(0, actorLevel);
    update({
      groupId: group?.id ?? null,
      minLevel: choices.some((choice) => choice.value === values.minLevel)
        ? values.minLevel
        : (choices[0]?.value ?? 0),
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = form.validate();
    if (!draft) return;
    try {
      await onCreate(draft);
    } catch (cause) {
      form.fail(cause, 'Nu am putut crea evenimentul. Reîncearcă.');
    }
  }

  const groupLabel = (group: EventFormGroup) =>
    groupOptionLabel(group, groupsById);

  return (
    <form aria-label="Eveniment nou" onSubmit={submit} noValidate>
      <fieldset disabled={pending} className="grid gap-5 disabled:opacity-70">
        <div className="grid gap-1.5">
          <label className="grid gap-1.5" htmlFor={`${id}-title`}>
            <span className="text-sm font-medium">Titlu</span>
            <input
              id={`${id}-title`}
              className={control}
              value={values.title}
              autoComplete="off"
              onChange={(event) => update({ title: event.target.value })}
              {...form.field('title')}
            />
          </label>
          <FieldError {...form.errorProps('title')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-type`}>
              <span className="text-sm font-medium">Tip</span>
              <select
                id={`${id}-type`}
                className={control}
                value={values.type}
                onChange={(event) =>
                  update({
                    type: event.target.value as EventFormValues['type'],
                  })
                }
                {...form.field('type')}
              >
                {EVENT_TYPE_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <FieldError {...form.errorProps('type')} />
          </div>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-min-level`}>
              <span className="text-sm font-medium">Cine îl vede</span>
              <select
                id={`${id}-min-level`}
                className={control}
                value={values.minLevel}
                onChange={(event) =>
                  update({ minLevel: Number(event.target.value) })
                }
                {...form.field('minLevel')}
              >
                {levelChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <FieldError {...form.errorProps('minLevel')} />
          </div>
        </div>

        <div className="grid gap-1.5" {...form.slot('groupId')}>
          <span id={`${id}-group`} className="text-sm font-medium">
            Grup
          </span>
          <Combobox<EventFormGroup>
            items={options.groups}
            value={selectedGroup}
            onValueChange={chooseGroup}
            itemToStringLabel={groupLabel}
            isItemEqualToValue={(a, b) => a.id === b.id}
          >
            <ComboboxTrigger aria-labelledby={`${id}-group`}>
              <ComboboxValue placeholder="Alege un grup">
                {(group: EventFormGroup | null) =>
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
                {(group: EventFormGroup) => (
                  <ComboboxItem key={group.id} value={group}>
                    <GroupOption group={group} groupsById={groupsById} />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldError {...form.errorProps('groupId')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-starts-at`}>
              <span className="text-sm font-medium">Începe — ora României</span>
              <input
                id={`${id}-starts-at`}
                type="datetime-local"
                className={control}
                value={values.startsAt}
                onChange={(event) => update({ startsAt: event.target.value })}
                {...form.field('startsAt')}
              />
            </label>
            <FieldError {...form.errorProps('startsAt')} />
          </div>
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-ends-at`}>
              <span className="text-sm font-medium">
                Se încheie (opțional) — ora României
              </span>
              <input
                id={`${id}-ends-at`}
                type="datetime-local"
                className={control}
                value={values.endsAt}
                onChange={(event) => update({ endsAt: event.target.value })}
                {...form.field('endsAt')}
              />
            </label>
            <FieldError {...form.errorProps('endsAt')} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5" htmlFor={`${id}-location`}>
            <span className="text-sm font-medium">Loc (opțional)</span>
            <input
              id={`${id}-location`}
              className={control}
              value={values.location}
              onChange={(event) => update({ location: event.target.value })}
            />
          </label>
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-capacity`}>
              <span className="text-sm font-medium">Capacitate (opțional)</span>
              <input
                id={`${id}-capacity`}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className={control}
                value={values.capacity}
                onChange={(event) => update({ capacity: event.target.value })}
                {...form.field('capacity')}
              />
            </label>
            <FieldError {...form.errorProps('capacity')} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <label className="grid gap-1.5" htmlFor={`${id}-description`}>
            <span className="text-sm font-medium">Descriere (opțional)</span>
            <textarea
              id={`${id}-description`}
              className={`${control} min-h-24 resize-y`}
              rows={4}
              value={values.description}
              onChange={(event) => update({ description: event.target.value })}
              {...form.field('description')}
            />
          </label>
          <FieldError {...form.errorProps('description')} />
        </div>

        <FieldError>{form.formError}</FieldError>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            Renunță
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Se creează…' : 'Creează evenimentul'}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
