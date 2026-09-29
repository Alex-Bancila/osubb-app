import { useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ChoiceRow } from '../../components/ui/radio-group';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
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
import { DialogFooter } from '../../components/ui/dialog';
import { eventSchema, fieldForReason } from '../../lib/schemas/event';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  EVENT_TYPE_CHOICES,
  emptyEventFormValues,
  eventCampaignsFor,
  mayAnnounceEvent,
  minimumLevelChoices,
  type EventDraft,
  type EventFormGroup,
  type EventFormOptions,
  type EventFormValues,
} from './event-form-model';

// The text fields wear the #842 select's field (border, fill, radius, inset),
// so Titlu, Tip, Grup and the dates read as one form (X12).
const control =
  'min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:border-input dark:bg-input/30';

const COPY = {
  create: {
    label: 'Eveniment nou',
    submit: 'Creează evenimentul',
    pending: 'Se creează…',
    failed: 'Nu am putut crea evenimentul. Reîncearcă.',
  },
  edit: {
    label: 'Editează evenimentul',
    submit: 'Salvează modificările',
    pending: 'Se salvează…',
    failed: 'Nu am putut salva modificările. Reîncearcă.',
  },
} as const;

/**
 * One form for **Eveniment nou** and **Editează evenimentul** (#849): the same
 * fields, rules and refusal placement; editing starts from the Event's values
 * and does not refuse a start that has already passed (`update_event` takes
 * one). A refusal keeps every value in place.
 */
export function EventForm({
  mode = 'create',
  initialValues = emptyEventFormValues,
  options,
  actorLevel,
  pending,
  onCancel,
  onSubmit,
}: {
  mode?: 'create' | 'edit';
  initialValues?: EventFormValues;
  options: EventFormOptions;
  actorLevel: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (draft: EventDraft, values: EventFormValues) => Promise<void>;
}) {
  const copy = COPY[mode];
  const id = useId();
  const [values, setValues] = useState<EventFormValues>(initialValues);
  const schema = useMemo(
    () => eventSchema(options, actorLevel, { creating: mode === 'create' }),
    [options, actorLevel, mode],
  );
  const form = useFormValidation(schema, values, fieldForReason);
  const groupsById = useMemo(
    () => new Map(options.groupNames.map((group) => [group.id, group])),
    [options.groupNames],
  );
  const selectedGroup =
    options.groups.find((group) => group.id === values.groupId) ?? null;
  const campaigns = eventCampaignsFor(selectedGroup, options.campaigns);
  // #909: "Creează și un anunț" — a new Event only, where the viewer may publish.
  const offersAnnouncement =
    mode === 'create' && mayAnnounceEvent(options, selectedGroup);
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
      // A Campaign belongs to the Group's path: a new Group starts without one.
      campaignId: group?.id === values.groupId ? values.campaignId : null,
      minLevel: choices.some((choice) => choice.value === values.minLevel)
        ? values.minLevel
        : (choices[0]?.value ?? 0),
    });
  }

  // A second submit before the pending state renders is dropped here.
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const draft = form.validate();
    if (!draft) return;
    submitting.current = true;
    try {
      await onSubmit(draft, values);
    } catch (cause) {
      form.fail(cause, copy.failed);
    } finally {
      submitting.current = false;
    }
  }

  const groupLabel = (group: EventFormGroup) =>
    groupOptionLabel(group, groupsById);

  return (
    <form aria-label={copy.label} onSubmit={submit} noValidate>
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
            <label htmlFor={`${id}-type`} className="text-sm font-medium">
              Tip
            </label>
            <NativeSelect
              id={`${id}-type`}
              value={values.type}
              onChange={(event) =>
                update({
                  type: event.target.value as EventFormValues['type'],
                })
              }
              {...form.field('type')}
            >
              {EVENT_TYPE_CHOICES.map((choice) => (
                <NativeSelectOption key={choice.value} value={choice.value}>
                  {choice.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError {...form.errorProps('type')} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-min-level`} className="text-sm font-medium">
              Cine îl vede
            </label>
            <NativeSelect
              id={`${id}-min-level`}
              value={values.minLevel}
              onChange={(event) =>
                update({ minLevel: Number(event.target.value) })
              }
              {...form.field('minLevel')}
            >
              {levelChoices.map((choice) => (
                <NativeSelectOption key={choice.value} value={choice.value}>
                  {choice.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError {...form.errorProps('minLevel')} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
            Campanie (opțional)
          </label>
          <NativeSelect
            id={`${id}-campaign`}
            value={values.campaignId ?? ''}
            disabled={!selectedGroup || !campaigns.length}
            onChange={(event) =>
              update({
                campaignId: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
            {...form.field('campaignId', `${id}-campaign-hint`)}
          >
            <NativeSelectOption value="">Fără campanie</NativeSelectOption>
            {campaigns.map((campaign) => (
              <NativeSelectOption key={campaign.id} value={campaign.id}>
                {campaign.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError {...form.errorProps('campaignId')} />
          <p
            id={`${id}-campaign-hint`}
            className="text-sm text-muted-foreground"
          >
            {!selectedGroup
              ? 'Alege întâi grupul: campaniile vin din grupul evenimentului și din cele de deasupra lui.'
              : !campaigns.length
                ? 'Grupul ales nu are campanii active.'
                : 'O etichetă pentru filtre și rapoarte. Nu schimbă cine vede evenimentul.'}
          </p>
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
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-location`}>
              <span className="text-sm font-medium">Loc (opțional)</span>
              <input
                id={`${id}-location`}
                className={control}
                value={values.location}
                onChange={(event) => update({ location: event.target.value })}
                {...form.field('location')}
              />
            </label>
            <FieldError {...form.errorProps('location')} />
          </div>
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

        {offersAnnouncement && (
          <div className="grid gap-0.5">
            <ChoiceRow className="font-medium">
              <Checkbox
                checked={values.announce}
                aria-describedby={`${id}-announce-hint`}
                onCheckedChange={(next) => update({ announce: next === true })}
              />
              Creează și un anunț
            </ChoiceRow>
            <p
              id={`${id}-announce-hint`}
              className="pl-8 text-sm text-muted-foreground"
            >
              Publică în Anunțuri titlul, data, locul și descrierea, pentru cine
              vede evenimentul, cu termen la începutul lui.
            </p>
          </div>
        )}

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
            {pending ? copy.pending : copy.submit}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
