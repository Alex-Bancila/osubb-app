import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AttachedLinksFields } from '../attached-link/AttachedLinksFields';
import { FormattedTextField } from '../formatted-text/FormattedTextField';
import { SubHeading } from '../layout';
import { MemberName } from '../member/MemberName';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
import { FormSheetFooter } from '../ui/form-sheet';
import { InfoHint } from '../ui/info-hint';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import {
  completedTaskFieldForReason,
  completedTaskSchema,
  type CompletedTaskInput,
} from '../../lib/schemas/completed-task';
import { MAX_TASK_COPIES } from '../../lib/schemas/task';
import { useFormValidation } from '../../lib/use-form-validation';
import type {
  CompletedTaskDraft,
  CompletedTaskOptions,
} from '../../queries/completed-tasks';
import { previewPoints } from '../../lib/difficulty-levels';
import { useEvaluationScale } from '../../queries/reference';
import { RatingGuideDialog } from '../../screens/tracker/RatingGuideDialog';
import { TaskGroupCascade } from '../../screens/tracker/TaskGroupCascade';
import {
  campaignsFor,
  rootGroups,
  type ManagedWorkGroup,
} from '../../screens/tracker/task-form-model';
import { EvaluationInputs } from './EvaluationInputs';
import { VolunteerPicker } from './VolunteerPicker';

const COPIES_INFO =
  'Adaugă același task finalizat pentru mai mulți voluntari odată, până la 100. Alegi voluntarii la pasul următor; aceeași persoană poate fi aleasă de mai multe ori.';

/** A volunteer already decided by where the form opened: the requester, or the tracked Member. */
export type FixedVolunteer = {
  id: string;
  nickname: string | null;
  fullName: string;
};

/**
 * The completed-Task form (#915), one component for both ways a completed
 * Task is written:
 *
 * - approving a Completed-work Request — the requester is the volunteer, the
 *   Request's text and Group come prefilled, and the decider may change them;
 * - "Adaugă task finalizat" — the manager picks the Group and then the
 *   volunteer among the members that Group may credit (or the volunteer is
 *   fixed, on Trackerul membrului) — and, with `copies`, how many times:
 *   at several copies the volunteers are chosen one per copy in a second
 *   step, so the form hands over a draft with no volunteer and the count
 *   (spec 2026-10-11, Part E).
 *
 * The Task first (Grup, Voluntar, Titlu, Detalii, Campanie, Link atașat — no
 * deadline, no Audience: a completed Task is no Opportunity), then the
 * Evaluation (Dificultate as stars or a responsibility, Nota as a number,
 * R29a, #986), with the rating guide on the chosen Group's list. Only Groups and
 * volunteers the server would accept are offered; the command still decides.
 *
 * It is a form sheet's content, in both places: it grows to the sheet's
 * height and ends with the pinned footer (Renunță, then the submit button).
 */
export function CompletedTaskForm({
  options,
  volunteer,
  volunteerLabel = 'Voluntar',
  copies = false,
  initial,
  submitLabel,
  isPending,
  onSubmit,
  onCancel,
}: {
  options: CompletedTaskOptions;
  /** `null`: the manager chooses the volunteer after the Group. */
  volunteer: FixedVolunteer | null;
  /**
   * The line naming the fixed volunteer; null when the host already shows
   * them (an approval's Request summary names the requester).
   */
  volunteerLabel?: string | null;
  /** Offer the Exemplare count (Part E); above 1 the volunteers come in the next step. */
  copies?: boolean;
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
      copies: '1',
      links: [],
      campaignId: null,
      difficulty: '',
      rating: '',
      note: '',
    };
  });
  const origin = options.groups.find((group) => group.id === values.groupId);
  const campaigns = campaignsFor(origin, options);
  // Several copies: the volunteers are chosen in the next step, one per copy.
  const manyCopies = copies && !volunteer && Number(values.copies) > 1;
  const schema = useMemo(
    () =>
      completedTaskSchema({
        groupIds: options.groups.map((group) => group.id),
        campaigns: (groupId) =>
          campaignsFor(
            options.groups.find((group) => group.id === groupId),
            options,
          ).map((campaign) => campaign.id),
        volunteerRequired: !manyCopies,
      }),
    [options, manyCopies],
  );
  const form = useFormValidation(
    schema,
    values,
    completedTaskFieldForReason(volunteer ? 'groupId' : 'executorId'),
  );
  const submitting = useRef(false);
  const points = previewPoints(scale.data, values.difficulty, values.rating);

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
    if (!parsed || parsed.groupId === null) return;
    if (!manyCopies && parsed.executorId === null) return;
    submitting.current = true;
    try {
      await onSubmit({
        executorId: manyCopies ? null : parsed.executorId,
        groupId: parsed.groupId,
        title: parsed.title,
        description: parsed.description,
        links: parsed.links,
        campaignId: parsed.campaignId,
        difficulty: parsed.difficulty,
        rating: parsed.rating,
        note: parsed.note,
        copies: parsed.copies,
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
      className="flex flex-1 flex-col gap-6"
    >
      <fieldset
        disabled={isPending}
        aria-labelledby={`${id}-task`}
        className="grid min-w-0 gap-4"
      >
        <SubHeading id={`${id}-task`}>Taskul</SubHeading>
        {volunteer && volunteerLabel && (
          <p className="m-0 text-sm" data-slot="completed-volunteer">
            <span className="text-muted-foreground">{volunteerLabel}: </span>
            <MemberName
              memberId={volunteer.id}
              nickname={volunteer.nickname}
              fullName={volunteer.fullName}
              className="font-semibold"
            />
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
        {copies && !volunteer && (
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
        )}
        {!volunteer && manyCopies && (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Voluntari</span>
            <p className="m-0 text-sm text-muted-foreground">
              Voluntarii se aleg la pasul următor, câte unul pentru fiecare
              exemplar.
            </p>
          </div>
        )}
        {!volunteer && !manyCopies && (
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
          <label
            id={`${id}-description-label`}
            htmlFor={`${id}-description`}
            className="text-sm font-medium"
          >
            Detalii (opțional)
          </label>
          <FormattedTextField
            id={`${id}-description`}
            labelId={`${id}-description-label`}
            name="description"
            value={values.description}
            onChange={(description) => update({ description })}
            {...form.field('description')}
          />
          <FieldError {...form.errorProps('description')} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
            Campanie (opțional)
          </label>
          <Select
            id={`${id}-campaign`}
            value={
              campaigns.some((campaign) => campaign.id === values.campaignId)
                ? String(values.campaignId ?? '')
                : ''
            }
            disabled={isPending || !origin || !campaigns.length}
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
          {origin && !campaigns.length && (
            <p
              id={`${id}-campaign-hint`}
              className="text-sm text-muted-foreground"
            >
              Grupul ales nu are campanii active.
            </p>
          )}
        </div>
        <AttachedLinksFields
          value={values.links}
          onChange={(links) => update({ links })}
          form={form}
          name="links"
          disabled={isPending}
        />
      </fieldset>
      <div className="grid gap-4 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubHeading>Evaluarea</SubHeading>
          <RatingGuideDialog
            groupId={values.groupId}
            selection={{
              difficulty:
                values.difficulty === '' ? null : Number(values.difficulty),
              rating: values.rating === '' ? null : Number(values.rating),
            }}
            onSet={(patch) =>
              update({
                ...(patch.difficulty !== undefined
                  ? { difficulty: String(patch.difficulty) }
                  : {}),
                ...(patch.rating !== undefined
                  ? { rating: String(patch.rating) }
                  : {}),
              })
            }
          />
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
          points={points}
        />
      </div>
      <FieldError>{form.formError}</FieldError>
      <FormSheetFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
        >
          Renunță
        </Button>
        <Button type="submit" disabled={isPending || !scale.data}>
          {isPending ? 'Se salvează…' : manyCopies ? 'Continuă' : submitLabel}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
