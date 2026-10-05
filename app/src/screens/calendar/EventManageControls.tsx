import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
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
} from './event-form-model';

/**
 * **Editează** and **Anulează evenimentul** on a Calendar card (#849), for the
 * people `update_event` / `cancel_event` accept (`canManageEvent`), and
 * **Șterge definitiv** (#1017) for the same managers — on a cancelled Event
 * too, which `delete_event` accepts. Nobody else sees them; the server still
 * decides, and a refusal is shown in the dialog in Romanian.
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
  const update = useUpdateEvent();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const saved = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && update.isPending) return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => {
          saved.current = false;
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      >
        Editează
      </Button>
      {/* After a save the receipt takes focus; otherwise back to Editează. */}
      <DialogContent
        fullScreenOnPhone
        className="sm:max-w-2xl"
        finalFocus={() => !saved.current}
      >
        <DialogHeader>
          <DialogTitle>Editează evenimentul</DialogTitle>
          <DialogDescription>
            O schimbare de oră, loc, grup sau vizibilitate îi anunță pe membrii
            grupului și pe cei care au răspuns „Particip”. Orele sunt
            interpretate în fusul României.
          </DialogDescription>
        </DialogHeader>
        <EditEventForm
          key={attempt}
          event={event}
          groups={groups}
          options={options}
          pending={update.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={async (draft) => {
            await update.mutateAsync({ eventId: event.id, draft });
            saved.current = true;
            setOpen(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditEventForm({
  event,
  groups,
  options,
  pending,
  onCancel,
  onSubmit,
}: {
  event: EventPresentation;
  groups: ReadonlyMap<number, Group> | undefined;
  options: EventFormOptions;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (draft: EventDraft) => Promise<void>;
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
  // Read once, when the dialog opens: a refetch must not reset what is typed.
  const [initialValues] = useState(() => eventFormValuesFor(event));

  return (
    <EventForm
      mode="edit"
      initialValues={initialValues}
      options={formOptions}
      actorLevel={actorLevel}
      pending={pending}
      onCancel={onCancel}
      onSubmit={(draft, values) =>
        onSubmit(keepUntouchedTimes(draft, values, initialValues, event))
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
      triggerLabel="Anulează evenimentul"
      title="Anulează evenimentul"
      description={
        <>
          „{event.title}” rămâne în Calendar marcat „Anulat”, cu motivul de mai
          jos. Membrii grupului și cei care au răspuns „Particip” primesc o
          notificare. Anularea nu poate fi retrasă.
        </>
      }
      field="reason"
      fieldLabel="Motiv (obligatoriu)"
      confirmLabel="Confirmă anularea"
      failureMessage="Nu am putut anula evenimentul. Reîncearcă."
      isPending={cancel.isPending}
      onConfirm={(reason) => cancel.mutateAsync({ eventId: event.id, reason })}
      onSuccess={onCancelled}
    />
  );
}
