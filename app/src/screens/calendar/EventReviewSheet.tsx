import type { ReviewOutcome } from '../../queries/approvals';
import { useEventFormOptions } from '../../queries/event-creation';
import { useEvent } from '../../queries/events';
import { useReadNotificationsAbout } from '../../queries/notifications';
import { useGroups } from '../../queries/reference';
import { EditEventSheet } from './EventManageControls';

/**
 * BC's review of one OSUBB-wide Event (spec 2026-10-11): the Event form in
 * review mode over the row as the server holds it — BC reads every pending
 * Event — with the form's own options, so what is approved is what the author
 * wrote, corrected where BC chose to. Nothing is drawn until both are here.
 */
export function EventReviewSheet({
  id,
  open,
  onOpenChange,
  onDecided,
}: {
  id: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: (outcome: ReviewOutcome) => void;
}) {
  // R37: opening reads its Notifications — the request's own "Cerere de
  // aprobare" (event:<id>) whichever way the review was opened.
  useReadNotificationsAbout([`event:${id}`]);
  const event = useEvent(id);
  const options = useEventFormOptions();
  const groups = useGroups();
  if (!event.data || !options.data) return null;
  return (
    <EditEventSheet
      key={id}
      event={event.data}
      groups={groups.data}
      options={options.data}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={() => onOpenChange(false)}
      review={{ onDecided }}
    />
  );
}
