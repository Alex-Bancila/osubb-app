import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
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
  useApproveAnnouncement,
  useRejectAnnouncement,
  type ReviewOutcome,
} from '../../queries/approvals';
import { TaskReasonDialog } from '../tracker/TaskReasonDialog';
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
 * BC's review of a pending OSUBB-wide Announcement (spec 2026-10-11): the
 * same sheet, with the decision in the footer. `onDecided` runs after the
 * command succeeds; the caller closes the sheet and shows the receipt.
 */
export type AnnouncementReview = {
  onDecided: (outcome: ReviewOutcome) => void;
};

const DECISION_FAILED = 'Nu am putut salva decizia. Încearcă din nou.';

/**
 * "Editează anunțul" (#930): the Anunț nou fields, prefilled. The Origin and
 * Audience are shown, never changed (moving an Announcement is out of scope);
 * the pin has its own control in the details sheet. Save sends only what
 * changed and notifies nobody again. The caller keys it by the opening, so
 * every Editează starts from the stored row.
 *
 * In review mode (`review`, spec 2026-10-11) the sheet is "Revizuiește
 * anunțul": **Aprobă și publică** saves BC's edits, if any, then approves —
 * the Announcement stays the author's — and **Respinge** asks for the reason
 * the author is told.
 */
export default function AnnouncementEditSheet({
  announcement,
  open,
  onOpenChange,
  onSaved,
  review,
}: {
  announcement: AnnouncementPresentation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  review?: AnnouncementReview;
}) {
  const update = useUpdateAnnouncement();
  const approve = useApproveAnnouncement();
  const reject = useRejectAnnouncement();
  const busy = update.isPending || approve.isPending || reject.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={review ? 'Revizuiește anunțul' : 'Editează anunțul'}
      busy={busy}
    >
      <EditForm
        announcement={announcement}
        update={update}
        approve={approve}
        reject={reject}
        busy={busy}
        review={review}
        onCancel={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormSheet>
  );
}

function EditForm({
  announcement,
  update,
  approve,
  reject,
  busy,
  review,
  onCancel,
  onSaved,
}: {
  announcement: AnnouncementPresentation;
  update: ReturnType<typeof useUpdateAnnouncement>;
  approve: ReturnType<typeof useApproveAnnouncement>;
  reject: ReturnType<typeof useRejectAnnouncement>;
  busy: boolean;
  review: AnnouncementReview | undefined;
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
      links: draft.links,
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
    const changed = Object.keys(changes).length > 0;
    if (!review && !changed) {
      onCancel();
      return;
    }
    try {
      // In review the edit lands first, so the organisation reads BC's
      // corrected text when the approval publishes it.
      if (changed) await update.mutateAsync({ id: announcement.id, changes });
      if (review) {
        await approve.mutateAsync({ id: announcement.id });
        review.onDecided('approved');
      } else {
        onSaved();
      }
    } catch (cause) {
      // A guard's 23514 reason lands under its field (R8).
      form.fail(
        cause,
        isAnnouncementRefusal(cause)
          ? 'Nu poți modifica acest anunț.'
          : review
            ? DECISION_FAILED
            : 'Anunțul nu a putut fi salvat. Încearcă din nou.',
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-1 flex-col gap-5"
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
      <FormSheetFooter>
        {review ? (
          <>
            <TaskReasonDialog
              triggerLabel="Respinge"
              title="Respinge anunțul"
              description="Autorul este anunțat și vede motivul pe anunțul său; îl poate corecta și trimite din nou."
              field="rejection"
              fieldLabel="Motivul respingerii"
              confirmLabel="Respinge"
              failureMessage={DECISION_FAILED}
              isPending={reject.isPending}
              onConfirm={(reason) =>
                reject.mutateAsync({ id: announcement.id, reason })
              }
              onSuccess={() => review.onDecided('rejected')}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Se trimite…' : 'Aprobă și publică'}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              Renunță
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Se salvează…' : 'Salvează modificările'}
            </Button>
          </>
        )}
      </FormSheetFooter>
    </form>
  );
}
