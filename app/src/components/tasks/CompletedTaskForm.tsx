import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { AttachedLinkFields } from '../attached-link/AttachedLinkFields';
import { SubHeading } from '../layout';
import { Button } from '../ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  MemberOption,
} from '../ui/combobox';
import { DialogFooter } from '../ui/dialog';
import { FieldError } from '../ui/field';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import {
  completedTaskFieldForReason,
  completedTaskSchema,
  type CompletedTaskInput,
} from '../../lib/schemas/completed-task';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useCompletedTaskExecutors,
  type CompletedTaskDraft,
  type CompletedTaskOptions,
  type CompletedTaskVolunteer,
} from '../../queries/completed-tasks';
import { useEvaluationScale } from '../../queries/reference';
import { RatingGuideDialog } from '../../screens/tracker/RatingGuideDialog';
import { TaskGroupCascade } from '../../screens/tracker/TaskGroupCascade';
import {
  campaignsFor,
  rootGroups,
  type ManagedWorkGroup,
} from '../../screens/tracker/task-form-model';
import { EvaluationInputs } from './EvaluationInputs';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** A volunteer already decided by where the form opened: the requester, or the tracked Member. */
export type FixedVolunteer = { id: string; name: string };

/**
 * The completed-Task form (#915), one component for both ways a completed
 * Task is written:
 *
 * - approving a Completed-work Request — the requester is the volunteer, the
 *   Request's text and Group come prefilled, and the decider may change them;
 * - "Adaugă task finalizat" — the manager picks the Group and then the
 *   volunteer among the members that Group may credit (or the volunteer is
 *   fixed, on Trackerul membrului).
 *
 * The Task first (Grup, Voluntar, Titlu, Detalii, Campanie, Link atașat — no
 * deadline, no Audience: a completed Task is no Opportunity), then the
 * Evaluation (Dificultate as stars, Nota as a number, R29a). Only Groups and
 * volunteers the server would accept are offered; the command still decides.
 */
export function CompletedTaskForm({
  options,
  volunteer,
  volunteerLabel = 'Voluntar',
  initial,
  submitLabel,
  isPending,
  onSubmit,
  onCancel,
}: {
  options: CompletedTaskOptions;
  /** `null`: the manager chooses the volunteer after the Group. */
  volunteer: FixedVolunteer | null;
  /** How the fixed volunteer is named: "Solicitant" on an approval. */
  volunteerLabel?: string;
  initial?: { title?: string; description?: string; groupId?: number | null };
  submitLabel: string;
  isPending: boolean;
  onSubmit: (draft: CompletedTaskDraft) => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const scale = useEvaluationScale();
  const [values, setValues] = useState<CompletedTaskInput>(() => {
    const roots = rootGroups(options.groups);
    return {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      groupId:
        initial?.groupId ??
        (options.groups.length === 1 && roots[0] ? roots[0].id : null),
      executorId: volunteer?.id ?? null,
      link: { label: '', url: '' },
      campaignId: null,
      difficulty: '',
      rating: '',
      note: '',
    };
  });
  const origin = options.groups.find((group) => group.id === values.groupId);
  const campaigns = campaignsFor(origin, options);
  const schema = useMemo(
    () =>
      completedTaskSchema({
        groupIds: options.groups.map((group) => group.id),
        campaigns: (groupId) =>
          campaignsFor(
            options.groups.find((group) => group.id === groupId),
            options,
          ).map((campaign) => campaign.id),
      }),
    [options],
  );
  const form = useFormValidation(
    schema,
    values,
    completedTaskFieldForReason(volunteer ? 'groupId' : 'executorId'),
  );
  const submitting = useRef(false);
  const chosen = scale.data?.ratings.find(
    (row) => row.rating === Number(values.rating),
  );
  const points =
    values.difficulty && chosen
      ? Number(values.difficulty) * chosen.multiplier
      : null;

  function update(patch: Partial<CompletedTaskInput>) {
    setValues((current) => ({ ...current, ...patch }));
  }
  function chooseGroup(group: ManagedWorkGroup) {
    // A Campaign that can still tag the new Group stays; the volunteer list
    // re-reads for it, and clears a volunteer it no longer offers.
    const campaignStays = campaignsFor(group, options).some(
      (campaign) => campaign.id === values.campaignId,
    );
    update({
      groupId: group.id,
      campaignId: campaignStays ? values.campaignId : null,
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = form.validate();
    if (!parsed || parsed.groupId === null || parsed.executorId === null)
      return;
    submitting.current = true;
    try {
      await onSubmit({
        executorId: parsed.executorId,
        groupId: parsed.groupId,
        title: parsed.title,
        description: parsed.description,
        link: parsed.link,
        campaignId: parsed.campaignId,
        difficulty: parsed.difficulty,
        rating: parsed.rating,
        note: parsed.note,
      });
    } catch (failure) {
      form.fail(
        failure,
        'Nu am putut salva taskul finalizat. Încearcă din nou.',
      );
    } finally {
      submitting.current = false;
    }
  }

  if (!options.groups.length)
    return (
      <p role="status">
        {volunteer
          ? 'Nu există niciun grup în care poți acorda puncte acestui membru.'
          : 'Nu ai grupuri active în care poți acorda puncte.'}
      </p>
    );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Task finalizat"
      className="space-y-6"
    >
      <fieldset
        disabled={isPending}
        aria-labelledby={`${id}-task`}
        className="grid min-w-0 gap-4"
      >
        <SubHeading id={`${id}-task`}>Taskul</SubHeading>
        {volunteer && (
          <p className="m-0 text-sm" data-slot="completed-volunteer">
            <span className="text-muted-foreground">{volunteerLabel}: </span>
            <span className="font-semibold">{volunteer.name}</span>
          </p>
        )}
        <div className="grid gap-1.5" {...form.slot('groupId')}>
          <TaskGroupCascade
            groups={options.groups}
            groupsById={options.groupNames}
            value={values.groupId}
            onChange={chooseGroup}
            disabled={isPending}
            describedBy={
              form.error('groupId') ? form.errorId('groupId') : undefined
            }
            invalid={form.error('groupId') !== undefined}
          />
          <FieldError {...form.errorProps('groupId')} />
        </div>
        {!volunteer && (
          <div className="grid gap-1.5" {...form.slot('executorId')}>
            <VolunteerPicker
              groupId={values.groupId}
              value={values.executorId}
              onChange={(executorId) => update({ executorId })}
              disabled={isPending}
              invalid={form.error('executorId') !== undefined}
              errorId={form.errorId('executorId')}
            />
            <FieldError {...form.errorProps('executorId')} />
          </div>
        )}
        <div className="grid gap-1.5">
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
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-description`} className="text-sm font-medium">
            Detalii
          </label>
          <textarea
            id={`${id}-description`}
            className={`${control} min-h-24`}
            rows={3}
            value={values.description}
            onChange={(event) => update({ description: event.target.value })}
            {...form.field('description')}
          />
          <FieldError {...form.errorProps('description')} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
            Campanie (opțional)
          </label>
          <NativeSelect
            id={`${id}-campaign`}
            value={
              campaigns.some((campaign) => campaign.id === values.campaignId)
                ? (values.campaignId ?? '')
                : ''
            }
            disabled={isPending || !origin || !campaigns.length}
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
          {origin && !campaigns.length && (
            <p
              id={`${id}-campaign-hint`}
              className="text-sm text-muted-foreground"
            >
              Grupul ales nu are campanii active.
            </p>
          )}
        </div>
        <fieldset className="grid min-w-0 gap-3">
          <legend className="mb-3 text-sm font-medium">
            Link atașat (opțional)
          </legend>
          <AttachedLinkFields
            value={values.link}
            onChange={(link) => update({ link })}
            form={form}
            name="link"
            disabled={isPending}
          />
        </fieldset>
      </fieldset>
      <div className="grid gap-4 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubHeading>Evaluarea</SubHeading>
          <RatingGuideDialog />
        </div>
        {scale.isPending && (
          <p role="status" className="m-0 text-sm">
            Se încarcă dificultățile și notele…
          </p>
        )}
        {scale.isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p>Nu am putut încărca dificultățile și notele.</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={scale.isFetching}
              onClick={() => void scale.refetch()}
            >
              Reîncarcă
            </Button>
          </div>
        )}
        <EvaluationInputs
          id={id}
          values={values}
          onChange={update}
          form={form}
          disabled={isPending || !scale.data}
          difficultyHint={(value) =>
            scale.data?.difficulties.find((row) => row.stars === value)?.note ??
            null
          }
          points={points}
        />
      </div>
      <FieldError>{form.formError}</FieldError>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={isPending}
          onClick={onCancel}
        >
          Renunță
        </Button>
        <Button
          type="submit"
          className="min-h-11"
          disabled={isPending || !scale.data}
        >
          {isPending ? 'Se salvează…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Voluntar: the members the chosen Group may credit
 * (`completed_task_executors`), re-read when the Group changes. A volunteer
 * the new Group does not offer is cleared once that read succeeds.
 */
function VolunteerPicker({
  groupId,
  value,
  onChange,
  disabled,
  invalid,
  errorId,
}: {
  groupId: number | null;
  value: string | null;
  onChange: (memberId: string | null) => void;
  disabled: boolean;
  invalid: boolean;
  errorId: string;
}) {
  const id = useId();
  const query = useCompletedTaskExecutors(groupId);
  const members = useMemo(() => query.data ?? [], [query.data]);
  const selected = members.find((member) => member.id === value) ?? null;
  const offered = value === null || selected !== null;
  useEffect(() => {
    if (query.isSuccess && !offered) onChange(null);
  }, [query.isSuccess, offered, onChange]);
  return (
    <>
      <span id={`${id}-label`} className="text-sm font-medium">
        Voluntar (obligatoriu)
      </span>
      {groupId === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Alege întâi grupul: lista arată membrii lui.
        </p>
      ) : query.isPending ? (
        <p role="status" className="m-0 text-sm">
          Se încarcă membrii grupului…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="m-0">Nu am putut încărca membrii grupului.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Reîncarcă lista
          </Button>
        </div>
      ) : (
        <Combobox<CompletedTaskVolunteer>
          items={members}
          value={selected}
          onValueChange={(member) => onChange(member?.id ?? null)}
          itemToStringLabel={(member) => member.name}
          isItemEqualToValue={(a, b) => a.id === b.id}
          disabled={disabled || !members.length}
        >
          <ComboboxTrigger
            aria-labelledby={`${id}-label`}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
          >
            <ComboboxValue
              placeholder={
                members.length
                  ? 'Alege un membru'
                  : 'Niciun membru eligibil în acest grup'
              }
            >
              {(member: CompletedTaskVolunteer | null) =>
                member ? (
                  <MemberOption
                    name={member.name}
                    avatarColor={member.avatarColor}
                  />
                ) : members.length ? (
                  'Alege un membru'
                ) : (
                  'Niciun membru eligibil în acest grup'
                )
              }
            </ComboboxValue>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              aria-label="Caută un membru"
              placeholder="Caută după nume"
            />
            <ComboboxEmpty>Niciun membru găsit.</ComboboxEmpty>
            <ComboboxList>
              {(member: CompletedTaskVolunteer) => (
                <ComboboxItem key={member.id} value={member}>
                  <MemberOption
                    name={member.name}
                    avatarColor={member.avatarColor}
                  />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </>
  );
}
