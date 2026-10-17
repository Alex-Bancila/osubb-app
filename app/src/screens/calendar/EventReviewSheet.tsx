import { EmptyState } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { FormSheet } from '../../components/ui/form-sheet';
import type { ReviewOutcome } from '../../queries/approvals';
import { useEventFormOptions } from '../../queries/event-creation';
import { useEvent } from '../../queries/events';
import { useReadNotificationsAbout } from '../../queries/notifications';
import { useGroups } from '../../queries/reference';
import { EditEventSheet } from './EventManageControls';

/** The review sheet's title, the same before and after its Event is read. */
const REVIEW_TITLE = 'Revizuiește evenimentul';

/**
 * BC's review of one OSUBB-wide Event (spec 2026-10-11): the Event form in
 * review mode over the row as the server holds it — BC reads every pending
 * Event — with the form's own options, so what is approved is what the author
 * wrote, corrected where BC chose to. Until both are here the sheet opens on
 * their place, or on why they cannot be shown, so a tap on a request, a card
 * or a chip is never a tap on nothing.
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
  if (!event.data || !options.data)
    return (
      <FormSheet open={open} onOpenChange={onOpenChange} title={REVIEW_TITLE}>
        {event.isError || options.isError ? (
          <ErrorState
            error={event.error ?? options.error}
            text="Nu am putut încărca evenimentul."
            retryLabel="Reîncearcă"
            onRetry={() => {
              if (event.isError) void event.refetch();
              if (options.isError) void options.refetch();
            }}
            retrying={event.isFetching || options.isFetching}
          />
        ) : event.data === null ? (
          <EmptyState bare>Acest eveniment nu mai există.</EmptyState>
        ) : (
          <Loading label="Se încarcă evenimentul…" />
        )}
      </FormSheet>
    );
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
