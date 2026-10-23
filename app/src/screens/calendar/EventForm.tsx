import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ChoiceRow } from '../../components/ui/radio-group';
import { FieldError } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
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
import { DatePicker, DateTimePicker } from '../../components/ui/date-picker';
import { FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input, Textarea } from '../../components/ui/input';
import { eventSchema, fieldForReason } from '../../lib/schemas/event';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  EVENT_TYPE_CHOICES,
  emptyEventFormValues,
  eventCampaignsFor,
  mayAnnounceEvent,
  minimumLevelChoices,
  withAllDay,
  withDay,
  withEventDates,
  type EventDraft,
  type EventFormGroup,
  type EventFormOptions,
  type EventFormValues,
} from './event-form-model';

/** Most of the organization's meetings are in the evening. */
const DEFAULT_START_TIME = '18:00';
const DEFAULT_END_TIME = '20:00';

/** Two hours after the start, the same day: where "Se încheie" opens. */
function defaultEndTime(startsAt: string): string {
  const match = /T(\d{2}):(\d{2})$/.exec(startsAt);
  if (!match) return DEFAULT_END_TIME;
  const hour = Number(match[1]) + 2;
  return hour > 23 ? '23:59' : `${String(hour).padStart(2, '0')}:${match[2]}`;
}

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
    // What a save sets off: read before pressing it, so it stays on the form.
    note: 'O schimbare de oră, loc, grup sau vizibilitate îi anunță pe membrii grupului și pe cei care au răspuns „Particip”.',
  },
  // BC's review of a pending OSUBB-wide Event (spec 2026-10-11).
  review: {
    label: 'Revizuiește evenimentul',
    submit: 'Aprobă și publică',
    pending: 'Se trimite…',
    failed: 'Nu am putut salva decizia. Încearcă din nou.',
    note: 'Modificările se salvează înainte de publicare; evenimentul rămâne al autorului, iar organizația află de el la aprobare.',
  },
} as const;

/**
 * One form for **Eveniment nou** and **Editează evenimentul** (#849): the same
 * fields, rules and refusal placement; editing starts from the Event's values
 * and does not refuse a start that has already passed (`update_event` takes
 * one). A refusal keeps every value in place. It is a `FormSheet`'s content:
 * the fields scroll, the actions stay pinned at the sheet's bottom edge.
 */
export function EventForm({
  mode = 'create',
  initialValues = emptyEventFormValues,
  options,
  actorLevel,
  pending,
  onCancel,
  onSubmit,
  secondary,
}: {
  mode?: 'create' | 'edit' | 'review';
  initialValues?: EventFormValues;
  options: EventFormOptions;
  actorLevel: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (draft: EventDraft, values: EventFormValues) => Promise<void>;
  /** In place of Renunță: a review's Respinge (spec 2026-10-11). */
  secondary?: ReactNode;
}) {
  const copy = COPY[mode];
  const note = 'note' in copy ? copy.note : null;
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

  // #1098 (R63): an end on another day than the start ticks Toată ziua,
  // until the author has ticked or unticked it themselves.
  function updateDates(
    patch: Pick<Partial<EventFormValues>, 'startsAt' | 'endsAt'>,
  ) {
    setValues((current) => withEventDates(current, patch));
  }

  /** Toată ziua: a first day moved past the last one takes the last along. */
  function chooseFirstDay(day: string) {
    setValues((current) => {
      const lastDay = current.endsAt.slice(0, 10);
      return {
        ...current,
        startsAt: withDay(current.startsAt, day, DEFAULT_START_TIME),
        endsAt:
          lastDay && lastDay < day
            ? withDay(current.endsAt, day, defaultEndTime(current.startsAt))
            : current.endsAt,
      };
    });
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
    <form
      aria-label={copy.label}
      onSubmit={submit}
      noValidate
      className="flex flex-1 flex-col"
    >
      <fieldset
        disabled={pending}
        className="flex min-w-0 flex-1 flex-col gap-5 disabled:opacity-70"
      >
        <div className="grid gap-1.5">
          <label className="grid gap-1.5" htmlFor={`${id}-title`}>
            <span className="text-sm font-medium">Titlu</span>
            <Input
              id={`${id}-title`}
              required
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
            <Select
              id={`${id}-type`}
              value={values.type}
              options={EVENT_TYPE_CHOICES}
              onValueChange={(type) => update({ type })}
              {...form.field('type')}
            />
            <FieldError {...form.errorProps('type')} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-min-level`} className="text-sm font-medium">
              Cine îl vede
            </label>
            <Select
              id={`${id}-min-level`}
              value={String(values.minLevel)}
              options={levelChoices.map((choice) => ({
                value: String(choice.value),
                label: choice.label,
              }))}
              onValueChange={(minLevel) =>
                update({ minLevel: Number(minLevel) })
              }
              {...form.field('minLevel')}
            />
            <FieldError {...form.errorProps('minLevel')} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
              Campanie (opțional)
            </label>
            <InfoHint label="Despre campanie" id={`${id}-campaign-hint`}>
              {!selectedGroup
                ? 'Alege întâi grupul: campaniile vin din grupul evenimentului și din cele de deasupra lui.'
                : !campaigns.length
                  ? 'Grupul ales nu are campanii active.'
                  : 'O etichetă pentru filtre și rapoarte. Nu schimbă cine vede evenimentul.'}
            </InfoHint>
          </div>
          <Select
            id={`${id}-campaign`}
            value={String(values.campaignId ?? '')}
            disabled={!selectedGroup || !campaigns.length}
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
            {...form.field('campaignId', `${id}-campaign-hint`)}
          />
          <FieldError {...form.errorProps('campaignId')} />
        </div>

        {/* #1098 (R63): Toată ziua. Ticked, the pickers choose days, the
            last one included; the times wait in the values for an untick. */}
        <div className="flex items-center justify-between gap-2">
          <ChoiceRow className="font-medium">
            <Checkbox
              checked={values.allDay}
              aria-describedby={`${id}-all-day-hint`}
              onCheckedChange={(next) =>
                setValues((current) =>
                  withAllDay(
                    current,
                    next === true,
                    defaultEndTime(current.startsAt),
                  ),
                )
              }
            />
            Toată ziua
          </ChoiceRow>
          <InfoHint label="Despre toată ziua" id={`${id}-all-day-hint`}>
            Evenimentul ține de la prima la ultima zi, fără ore. Se bifează
            singur când alegi un sfârșit în altă zi; debifează-l ca să păstrezi
            orele exacte.
          </InfoHint>
        </div>

        {values.allDay ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-starts-at`}
                className="text-sm font-medium"
              >
                Prima zi
              </label>
              <DatePicker
                id={`${id}-starts-at`}
                required
                disabled={pending}
                value={values.startsAt.slice(0, 10)}
                onChange={chooseFirstDay}
                {...form.field('startsAt')}
              />
              <FieldError {...form.errorProps('startsAt')} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-ends-at`} className="text-sm font-medium">
                Ultima zi
              </label>
              <DatePicker
                id={`${id}-ends-at`}
                required
                disabled={pending}
                min={values.startsAt.slice(0, 10) || undefined}
                openOn={values.startsAt.slice(0, 10) || undefined}
                value={values.endsAt.slice(0, 10)}
                onChange={(day) =>
                  update({
                    endsAt: withDay(
                      values.endsAt,
                      day,
                      defaultEndTime(values.startsAt),
                    ),
                  })
                }
                {...form.field('endsAt')}
              />
              <FieldError {...form.errorProps('endsAt')} />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-starts-at`}
                className="text-sm font-medium"
              >
                Începe — ora României
              </label>
              <DateTimePicker
                id={`${id}-starts-at`}
                required
                disabled={pending}
                defaultTime={DEFAULT_START_TIME}
                value={values.startsAt}
                onChange={(startsAt) => updateDates({ startsAt })}
                {...form.field('startsAt')}
              />
              <FieldError {...form.errorProps('startsAt')} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-ends-at`} className="text-sm font-medium">
                Se încheie (opțional) — ora României
              </label>
              <DateTimePicker
                id={`${id}-ends-at`}
                disabled={pending}
                defaultTime={defaultEndTime(values.startsAt)}
                // It ends after it starts: no day before the start's.
                min={values.startsAt.slice(0, 10) || undefined}
                // …and an empty end opens on the start's month, not today's.
                openOn={values.startsAt.slice(0, 10) || undefined}
                value={values.endsAt}
                onChange={(endsAt) => updateDates({ endsAt })}
                {...form.field('endsAt')}
              />
              <FieldError {...form.errorProps('endsAt')} />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="grid gap-1.5" htmlFor={`${id}-location`}>
              <span className="text-sm font-medium">Loc (opțional)</span>
              <Input
                id={`${id}-location`}
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
              <Input
                id={`${id}-capacity`}
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
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
            <Textarea
              id={`${id}-description`}
              rows={4}
              value={values.description}
              onChange={(event) => update({ description: event.target.value })}
              {...form.field('description')}
            />
          </label>
          <FieldError {...form.errorProps('description')} />
        </div>

        {offersAnnouncement && (
          <div className="flex items-center justify-between gap-2">
            <ChoiceRow className="font-medium">
              <Checkbox
                checked={values.announce}
                aria-describedby={`${id}-announce-hint`}
                onCheckedChange={(next) => update({ announce: next === true })}
              />
              Creează și un anunț
            </ChoiceRow>
            <InfoHint
              label="Despre anunțul evenimentului"
              id={`${id}-announce-hint`}
            >
              Publică în Anunțuri titlul, data, locul și descrierea, pentru cine
              vede evenimentul, cu termen la începutul lui.
            </InfoHint>
          </div>
        )}

        {note && <p className="m-0 text-sm text-muted-foreground">{note}</p>}

        <FieldError>{form.formError}</FieldError>

        <FormSheetFooter>
          {secondary ?? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCancel}
            >
              Renunță
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? copy.pending : copy.submit}
          </Button>
        </FormSheetFooter>
      </fieldset>
    </form>
  );
}
