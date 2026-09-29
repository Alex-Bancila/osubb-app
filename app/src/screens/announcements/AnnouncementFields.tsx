import { useId, type ReactNode } from 'react';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import type { MinimumLevelOption } from '../../lib/minimum-level';
import type { useFormValidation } from '../../lib/use-form-validation';
import type { AnnouncementDraft } from './announcement-draft';
import type { AnnouncementPriority } from './announcements-presentation';

export const announcementInputClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';
export const announcementFieldClass =
  'block space-y-1.5 text-sm font-medium text-foreground';

type Bound = Pick<ReturnType<typeof useFormValidation>, 'field' | 'errorProps'>;

/**
 * The fields an Announcement is written with, shared by "Anunț nou" and
 * "Editează anunțul" (#930) so the two can never drift: Titlu, Mesaj, Termen,
 * then the Origin (`origin`: a picker when composing, read-only when editing),
 * Cine îl vede, Prioritate, anything the caller adds (`extra`), and the
 * Attached Link.
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
  const linkGroupLabelId = useId();

  return (
    <>
      <div className="space-y-1.5">
        <label className={announcementFieldClass}>
          Titlu
          <input
            className={announcementInputClass}
            name="title"
            required
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            {...form.field('title')}
          />
        </label>
        <FieldError {...form.errorProps('title')} />
      </div>
      <div className="space-y-1.5">
        <label className={announcementFieldClass}>
          Mesaj
          <textarea
            className={`${announcementInputClass} min-h-24 resize-y`}
            name="body"
            required
            value={draft.body}
            onChange={(event) => onChange({ body: event.target.value })}
            {...form.field('body')}
          />
        </label>
        <FieldError {...form.errorProps('body')} />
      </div>
      <div className="space-y-1.5">
        <label className={announcementFieldClass}>
          Termen (opțional) — ora României
          <input
            className={announcementInputClass}
            name="deadline"
            type="datetime-local"
            value={draft.deadline}
            onChange={(event) => onChange({ deadline: event.target.value })}
            {...form.field('deadline')}
          />
        </label>
        <FieldError {...form.errorProps('deadline')} />
      </div>
      {origin}
      <label className={announcementFieldClass}>
        Cine îl vede
        <NativeSelect
          name="min_level"
          value={draft.minLevel}
          onChange={(event) =>
            onChange({ minLevel: Number(event.target.value) })
          }
        >
          {levelChoices.map((choice) => (
            <NativeSelectOption key={choice.level} value={choice.level}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className={announcementFieldClass}>
        Prioritate
        <NativeSelect
          name="priority"
          value={draft.priority}
          onChange={(event) =>
            onChange({ priority: event.target.value as AnnouncementPriority })
          }
        >
          <NativeSelectOption value="normal">Normală</NativeSelectOption>
          <NativeSelectOption value="important">Importantă</NativeSelectOption>
          <NativeSelectOption value="critical">Critică</NativeSelectOption>
        </NativeSelect>
      </label>
      {extra}
      <div
        role="group"
        aria-labelledby={linkGroupLabelId}
        className="space-y-3 rounded-md border p-4"
      >
        <p id={linkGroupLabelId} className="text-sm font-medium">
          Link atașat (opțional)
        </p>
        <AttachedLinkFields
          value={{ label: draft.linkLabel, url: draft.linkUrl }}
          onChange={(next) =>
            onChange({ linkLabel: next.label, linkUrl: next.url })
          }
          form={form}
          name="link"
        />
      </div>
    </>
  );
}
