import { useId, type ReactNode } from 'react';
import { AttachedLinksFields } from '../../components/attached-link/AttachedLinksFields';
import { DateTimePicker } from '../../components/ui/date-picker';
import { FieldError } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import type { MinimumLevelOption } from '../../lib/minimum-level';
import type { useFormValidation } from '../../lib/use-form-validation';
import type { AnnouncementDraft } from './announcement-draft';
import type { AnnouncementPriority } from './announcements-presentation';

const PRIORITIES: ReadonlyArray<{
  value: AnnouncementPriority;
  label: string;
}> = [
  { value: 'normal', label: 'Normală' },
  { value: 'important', label: 'Importantă' },
  { value: 'critical', label: 'Critică' },
];

type Bound = Pick<
  ReturnType<typeof useFormValidation>,
  'field' | 'errorProps' | 'slot'
>;

/**
 * The fields an Announcement is written with, shared by "Anunț nou" and
 * "Editează anunțul" (#930) so the two can never drift: Titlu, Mesaj, Termen,
 * then the Origin (`origin`: a picker when composing, read-only when editing),
 * Cine îl vede, Prioritate, anything the caller adds (`extra`), and the
 * Attached Links (up to five, ruling R46). They are the children of the
 * form's own column: its gap is what separates them.
 */
export function AnnouncementFields({
  draft,
  onChange,
  form,
  levelChoices,
  origin,
  extra,
}: {
  draft: AnnouncementDraft;
  onChange: (patch: Partial<AnnouncementDraft>) => void;
  form: Bound;
  levelChoices: readonly MinimumLevelOption[];
  origin: ReactNode;
  extra?: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Titlu
        </label>
        <Input
          id={`${id}-title`}
          name="title"
          required
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          {...form.field('title')}
        />
        <FieldError {...form.errorProps('title')} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-body`} className="text-sm font-medium">
          Mesaj
        </label>
        <Textarea
          id={`${id}-body`}
          name="body"
          required
          rows={4}
          value={draft.body}
          onChange={(event) => onChange({ body: event.target.value })}
          {...form.field('body')}
        />
        <FieldError {...form.errorProps('body')} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
          Termen (opțional) — ora României
        </label>
        <DateTimePicker
          id={`${id}-deadline`}
          name="deadline"
          defaultTime="23:59"
          value={draft.deadline}
          onChange={(deadline) => onChange({ deadline })}
          {...form.field('deadline')}
        />
        <FieldError {...form.errorProps('deadline')} />
      </div>
      {origin}
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-min-level`} className="text-sm font-medium">
          Cine îl vede
        </label>
        <Select
          id={`${id}-min-level`}
          name="min_level"
          value={String(draft.minLevel)}
          options={levelChoices.map((choice) => ({
            value: String(choice.level),
            label: choice.label,
          }))}
          onValueChange={(minLevel) => onChange({ minLevel: Number(minLevel) })}
        />
      </div>
      <div className="grid gap-1.5">
        <span id={`${id}-priority`} className="text-sm font-medium">
          Prioritate
        </span>
        <SegmentedRadio
          aria-labelledby={`${id}-priority`}
          name="priority"
          options={PRIORITIES}
          value={draft.priority}
          onValueChange={(priority) => onChange({ priority })}
        />
      </div>
      {extra}
      <AttachedLinksFields
        value={draft.links}
        onChange={(links) => onChange({ links })}
        form={form}
        name="links"
      />
    </>
  );
}
