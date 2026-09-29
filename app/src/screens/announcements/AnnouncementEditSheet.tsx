import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Sheet,
  SheetBackdrop,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useAuth } from '../../lib/auth';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import {
  GROUP_MINIMUM_LEVELS,
  minimumLevelOptions,
} from '../../lib/minimum-level';
import {
  announcementSchema,
  fieldForReason,
} from '../../lib/schemas/announcement';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  isAnnouncementRefusal,
  useUpdateAnnouncement,
} from '../../queries/announcements';
import {
  announcementChanges,
  draftFromAnnouncement,
  type AnnouncementDraft,
} from './announcement-draft';
import { AnnouncementFields } from './AnnouncementFields';
import {
  originLabel,
  type AnnouncementPresentation,
} from './announcements-presentation';

/**
 * "Editează anunțul" (#930): the Anunț nou fields, prefilled. The Origin and
 * Audience are shown, never changed (moving an Announcement is out of scope);
 * the pin has its own control in the details sheet. Save sends only what
 * changed and notifies nobody again. The caller keys it by the opening, so
 * every Editează starts from the stored row.
 */
export default function AnnouncementEditSheet({
  announcement,
  open,
  onOpenChange,
  onSaved,
}: {
  announcement: AnnouncementPresentation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const update = useUpdateAnnouncement();

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (update.isPending) return;
        onOpenChange(next);
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          side="right"
          className="max-w-xl gap-5 p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <SheetHeader showCloseButton={!update.isPending}>
            <SheetTitle>Editează anunțul</SheetTitle>
          </SheetHeader>
          <EditForm
            announcement={announcement}
            update={update}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

function EditForm({
  announcement,
  update,
  onCancel,
  onSaved,
}: {
  announcement: AnnouncementPresentation;
  update: ReturnType<typeof useUpdateAnnouncement>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { claims } = useAuth();
  const [initial] = useState(() => draftFromAnnouncement(announcement));
  const [draft, setDraft] = useState<AnnouncementDraft>(initial);
  const actorLevel = claims?.member_level ?? 0;
  // The stored Minimum Level stays on offer even above the editor's own rank,
  // so saving another field never lowers it.
  const levelChoices = minimumLevelOptions(
    GROUP_MINIMUM_LEVELS,
    (level) =>
      actorLevel >= 9 || level <= actorLevel || level === initial.minLevel,
  );
  const deadlineChanged = draft.deadline !== initial.deadline;
  const form = useFormValidation(
    announcementSchema,
    {
      title: draft.title,
      body: draft.body,
      groupId: announcement.groupId,
      link: { label: draft.linkLabel, url: draft.linkUrl },
      // R8 judges a Termen at creation only: an untouched one that has since
      // passed is not checked (nor sent); a new one must not be in the past.
      deadline:
        deadlineChanged && draft.deadline
          ? (bucharestWallTimeToIso(draft.deadline) ?? '')
          : null,
    },
    fieldForReason,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    const changes = announcementChanges(initial, draft, values);
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    try {
      await update.mutateAsync({ id: announcement.id, changes });
      onSaved();
    } catch (cause) {
      // A guard's 23514 reason lands under its field (R8).
      form.fail(
        cause,
        isAnnouncementRefusal(cause)
          ? 'Nu poți modifica acest anunț.'
          : 'Anunțul nu a putut fi salvat. Încearcă din nou.',
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-1 flex-col gap-4"
    >
      <AnnouncementFields
        draft={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        form={form}
        levelChoices={levelChoices}
        origin={
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/60 px-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">Grup de origine</dt>
            <dd className="m-0 font-medium">
              {originLabel(announcement.group)}
            </dd>
            <dt className="text-muted-foreground">Audiență</dt>
            <dd className="m-0 font-medium">
              {announcement.audience === 'org'
                ? 'Toată organizația'
                : 'Doar grupul'}
            </dd>
          </dl>
        }
      />
      <FieldError>{form.formError}</FieldError>
      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={onCancel}
        >
          Renunță
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Se salvează…' : 'Salvează modificările'}
        </Button>
      </SheetFooter>
    </form>
  );
}
