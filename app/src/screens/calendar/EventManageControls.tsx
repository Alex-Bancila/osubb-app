import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { CalendarX, Pencil } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { FormSheet } from '../../components/ui/form-sheet';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import {
  useApproveEvent,
  useRejectEvent,
  type ReviewOutcome,
} from '../../queries/approvals';
import { useCampaigns } from '../../queries/campaigns';
import { useEventFormOptions } from '../../queries/event-creation';
import {
  editEventFormOptions,
  eventFormValuesFor,
  keepUntouchedTimes,
  managesEvent,
  useCancelEvent,
  useUpdateEvent,
} from '../../queries/event-edit';
import type { EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import { TaskReasonDialog } from '../tracker/TaskReasonDialog';
import { EventDeleteDialog } from './EventDeleteDialog';
import { EventForm } from './EventForm';
import {
  setCalendarReceipt,
  setEventReceipt,
  useEventReceipt,
} from './event-receipts';
import {
  groupsAvailableAtLevel,
  type EventDraft,
  type EventFormOptions,
  type EventFormValues,
} from './event-form-model';

/**
 * **Editează** and **Anulează evenimentul** on a Calendar card (#849), for the
 * people `update_event` / `cancel_event` accept (`canManageEvent`), and
 * **Șterge definitiv** (#1017) for the same managers — on a cancelled Event
 * too, which `delete_event` accepts. Nobody else sees them; the server still
 * decides, and a refusal is shown in the sheet or dialog in Romanian.
 */
export function EventManageControls({
  event,
  groups,
}: {
  event: EventPresentation;
  groups: ReadonlyMap<number, Group> | undefined;
}) {
  const { session } = useAuth();
  const capabilities = useCapabilities();
  const options = useEventFormOptions();
  const receipt = useEventReceipt(event.id);

  const manages =
    capabilities.data !== undefined &&
    options.data !== undefined &&
    managesEvent(event, {
      memberId: session?.user.id,
      capabilities: capabilities.data,
      options: options.data,
    });
  // canManageEvent: a cancelled Event is terminal for Editează and Anulează.
  const allowed = manages && event.cancelledAt === null;

  // The receipt outlives the buttons: after a cancellation the card turns
  // cancelled and the actions go, the sentence stays. It lives outside the
  // card (event-receipts), which a new day remounts.
  if (!manages && receipt === null) return null;
  return (
    <div className="event-manage">
      {manages && options.data && (
        <div className="event-manage-actions">
          {allowed && (
            <>
              <EditEventDialog
                event={event}
                groups={groups}
                options={options.data}
                onSaved={() =>
                  setEventReceipt(event.id, 'Modificările sunt salvate.')
                }
              />
              <CancelEventDialog
                event={event}
                onCancelled={() =>
                  setEventReceipt(event.id, 'Evenimentul este anulat.')
                }
              />
            </>
          )}
          {/* The card goes with the Event: its receipt is the Calendar's. */}
          <EventDeleteDialog
            event={event}
            onDeleted={(text) => setCalendarReceipt(text)}
          />
        </div>
      )}
      {receipt !== null && <Receipt key={receipt}>{receipt}</Receipt>}
    </div>
  );
}

function Receipt({ children }: { children: string }) {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    message.current?.focus();
  }, []);
  return (
    <p
      ref={message}
      role="status"
      tabIndex={-1}
      className="event-manage-receipt"
    >
      {children}
    </p>
  );
}

function EditEventDialog({
  event,
  groups,
  options,
  onSaved,
}: {
  event: EventPresentation;
  groups: ReadonlyMap<number, Group> | undefined;
  options: EventFormOptions;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const saved = useRef(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        onClick={() => {
          saved.current = false;
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden="true" />
        Editează
      </Button>
      {/* Keyed by the opening, so every Editează starts from the stored row.
          After a save the receipt takes focus; otherwise back to Editează. */}
      <EditEventSheet
        key={attempt}
        event={event}
        groups={groups}
        options={options}
        open={open}
        onOpenChange={setOpen}
        finalFocus={() => !saved.current}
        onSaved={() => {
          saved.current = true;
          setOpen(false);
          onSaved();
        }}
      />
    </>
  );
}

/**
 * BC's review of a pending OSUBB-wide Event (spec 2026-10-11): `onDecided`
 * runs after the command succeeds; the caller closes the sheet and shows the
 * receipt.
 */
export type EventReview = {
  onDecided: (outcome: ReviewOutcome) => void;
};

const DECISION_FAILED = 'Nu am putut salva decizia. Încearcă din nou.';

/**
 * "Editează evenimentul" (#849) as a sheet: the Eveniment nou form prefilled,
 * a save sending every field. In review mode (`review`, spec 2026-10-11) it
 * is "Revizuiește evenimentul": **Aprobă și publică** saves BC's edits, if
 * any, then approves — the Event stays the author's — and **Respinge** asks
 * for the reason the author is told.
 */
export function EditEventSheet({
  event,
  groups,
  options,
  open,
  onOpenChange,
  onSaved,
  review,
  finalFocus,
}: {
  event: EventPresentation;
  groups: ReadonlyMap<number, Group> | undefined;
  options: EventFormOptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  review?: EventReview;
  finalFocus?: ComponentProps<typeof FormSheet>['finalFocus'];
}) {
  const update = useUpdateEvent();
  const approve = useApproveEvent();
  const reject = useRejectEvent();
  const busy = update.isPending || approve.isPending || reject.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={review ? 'Revizuiește evenimentul' : 'Editează evenimentul'}
      busy={busy}
      className="sm:max-w-2xl"
      finalFocus={finalFocus}
    >
      <EditEventForm
        event={event}
        groups={groups}
        options={options}
        mode={review ? 'review' : 'edit'}
        pending={busy}
        secondary={
          review ? (
            <TaskReasonDialog
              triggerLabel="Respinge"
              title="Respinge evenimentul"
              description="Autorul este anunțat și vede motivul pe evenimentul său; îl poate corecta și trimite din nou."
              field="rejection"
              fieldLabel="Motivul respingerii"
              confirmLabel="Respinge"
              failureMessage={DECISION_FAILED}
              isPending={reject.isPending}
              onConfirm={(reason) =>
                reject.mutateAsync({ id: event.id, reason })
              }
              onSuccess={() => review.onDecided('rejected')}
            />
          ) : undefined
        }
        onCancel={() => onOpenChange(false)}
        onSubmit={async (draft, changed) => {
          if (review) {
            // The edit lands first, so the organisation hears of the Event as
            // BC corrected it; an untouched form approves it as it stands.
            if (changed) await update.mutateAsync({ eventId: event.id, draft });
            await approve.mutateAsync({ id: event.id });
            review.onDecided('approved');
          } else {
            await update.mutateAsync({ eventId: event.id, draft });
            onSaved();
          }
        }}
      />
    </FormSheet>
  );
}

/** Whether the form still shows what it opened with; every value is a primitive. */
function sameValues(a: EventFormValues, b: EventFormValues): boolean {
  return (Object.keys(a) as (keyof EventFormValues)[]).every(
    (key) => a[key] === b[key],
  );
}

function EditEventForm({
  event,
  groups,
  options,
  mode,
  pending,
  secondary,
  onCancel,
  onSubmit,
}: {
  event: EventPresentation;
  groups: ReadonlyMap<number, Group> | undefined;
  options: EventFormOptions;
  mode: 'edit' | 'review';
  pending: boolean;
  secondary?: ReactNode;
  onCancel: () => void;
  /** `changed`: whether any field differs from the stored Event. */
  onSubmit: (draft: EventDraft, changed: boolean) => Promise<void>;
}) {
  const { claims } = useAuth();
  const actorLevel = claims?.member_level ?? 0;
  // Only to name a Campaign the Event keeps after it went inactive.
  const campaigns = useCampaigns();
  const formOptions = useMemo(() => {
    const available = {
      ...options,
      groups: groupsAvailableAtLevel(options, actorLevel),
    };
    return editEventFormOptions(available, event, groups, campaigns.data);
  }, [options, actorLevel, event, groups, campaigns.data]);
  // Read once, when the sheet opens: a refetch must not reset what is typed.
  const [initialValues] = useState(() => eventFormValuesFor(event));

  return (
    <EventForm
      mode={mode}
      initialValues={initialValues}
      options={formOptions}
      actorLevel={actorLevel}
      pending={pending}
      secondary={secondary}
      onCancel={onCancel}
      onSubmit={(draft, values) =>
        onSubmit(
          keepUntouchedTimes(draft, values, initialValues, event),
          !sameValues(values, initialValues),
        )
      }
    />
  );
}

function CancelEventDialog({
  event,
  onCancelled,
}: {
  event: EventPresentation;
  onCancelled: () => void;
}) {
  const cancel = useCancelEvent();
  return (
    <TaskReasonDialog
      triggerLabel={
        <span>
          Anulează <span className="max-sm:sr-only">evenimentul</span>
        </span>
      }
      triggerIcon={CalendarX}
      triggerSize="sm"
      title="Anulează evenimentul"
      description={
        <>
          „{event.title}” rămâne în Calendar marcat „Anulat”, cu motivul de mai
          jos. Membrii grupului și cei care au răspuns „Particip” primesc o
          notificare. Anularea nu poate fi retrasă.
        </>
      }
      field="reason"
      fieldLabel="Motiv"
      confirmLabel="Confirmă anularea"
      failureMessage="Nu am putut anula evenimentul. Reîncearcă."
      isPending={cancel.isPending}
      onConfirm={(reason) => cancel.mutateAsync({ eventId: event.id, reason })}
      onSuccess={onCancelled}
    />
  );
}
