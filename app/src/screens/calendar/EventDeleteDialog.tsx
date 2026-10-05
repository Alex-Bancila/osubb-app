import { useState } from 'react';
import {
  Consequences,
  DeleteForGoodDialog,
  type DeleteDialogControls,
} from '../../components/delete-for-good/DeleteForGoodDialog';
import {
  countLabel,
  NO_UNDO,
} from '../../components/delete-for-good/delete-text';
import { Button } from '../../components/ui/button';
import { DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import { useDeleteEvent } from '../../queries/delete-for-good';
import { useEventAttendance } from '../../queries/event-attendance';
import type { EventPresentation } from '../../queries/events';

const FAILED = 'Nu am putut șterge evenimentul. Încearcă din nou.';

/**
 * **Șterge definitiv** on an Event card (#1017): one confirm naming what goes
 * with it — every RSVP answer — and what stays: an Announcement published
 * together with the Event (#909) is its own post and remains.
 */
export function EventDeleteDialog({
  event,
  onDeleted,
}: {
  event: Pick<EventPresentation, 'id' | 'title' | 'type'>;
  /** The card leaves with the Event; the Calendar keeps this sentence. */
  onDeleted: (receipt: string) => void;
}) {
  return (
    <DeleteForGoodDialog
      title="Ștergi definitiv evenimentul?"
      className="event-manage-delete"
    >
      {(controls) => (
        <EventDeleteBody
          event={event}
          controls={controls}
          onDeleted={onDeleted}
        />
      )}
    </DeleteForGoodDialog>
  );
}

function EventDeleteBody({
  event,
  controls,
  onDeleted,
}: {
  event: Pick<EventPresentation, 'id' | 'title' | 'type'>;
  controls: DeleteDialogControls;
  onDeleted: (receipt: string) => void;
}) {
  const remove = useDeleteEvent();
  // A deadline takes no answers (B25); for the rest, the count when known.
  const takesRsvp = event.type !== 'deadline';
  const attendance = useEventAttendance(event.id, takesRsvp);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    controls.setBusy(true);
    try {
      await remove.mutateAsync(event.id);
      controls.close(true);
      onDeleted(`Evenimentul „${event.title}” a fost șters definitiv.`);
    } catch (failure) {
      controls.setBusy(false);
      setError(describeFailure(failure, FAILED).message);
    }
  }

  const going = attendance.data?.going.length ?? 0;
  const declined = attendance.data?.declined.length ?? 0;
  const answers =
    !takesRsvp || !attendance.data
      ? null
      : going + declined === 0
        ? 'Nimeni nu a răspuns încă.'
        : `Se șterg și răspunsurile membrilor: ${[
            going > 0 && countLabel(going, 'confirmare', 'confirmări'),
            declined > 0 && countLabel(declined, 'refuz', 'refuzuri'),
          ]
            .filter(Boolean)
            .join(' și ')}.`;
  const pending = remove.isPending;
  return (
    <>
      <DialogDescription>
        „{event.title}” dispare din Calendar pentru toți. {NO_UNDO}
      </DialogDescription>
      <Consequences
        label="Ce se întâmplă cu evenimentul"
        items={[
          ...(answers
            ? [answers]
            : takesRsvp
              ? ['Se șterg și răspunsurile membrilor.']
              : []),
          'Un anunț publicat odată cu evenimentul rămâne.',
        ]}
      />
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => controls.close()}
        >
          Renunță
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending ? 'Se șterge…' : 'Șterge definitiv'}
        </Button>
      </DialogFooter>
    </>
  );
}
