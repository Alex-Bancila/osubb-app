import { useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import {
  EventRsvpMutationError,
  useEventRsvp,
  useSetEventRsvp,
  type EventRsvpStatus,
} from '../../queries/event-rsvp';

type EventRsvpControlsProps = {
  eventId: number;
  eventTitle: string;
};

type Feedback = {
  /** `saved`: a new answer went through; `kept`: the chosen one, again. */
  kind: 'saved' | 'kept' | 'error';
  message: string;
};

const UNKNOWN_ERROR = 'Nu am putut salva răspunsul. Încearcă din nou.';

function mutationErrorMessage(error: unknown): string {
  return error instanceof EventRsvpMutationError
    ? error.message
    : UNKNOWN_ERROR;
}

function savedMessage(status: EventRsvpStatus, eventTitle: string): string {
  return status === 'going'
    ? `Ai confirmat participarea la „${eventTitle}”.`
    : `Ai anunțat că nu participi la „${eventTitle}”.`;
}

function keptMessage(status: EventRsvpStatus): string {
  return status === 'going'
    ? 'Participarea ta este deja confirmată.'
    : 'Ai anunțat deja că nu participi.';
}

/*
 * The chosen answer is a fill, not an outline: Particip in the brand red,
 * Nu particip in ink (the two colours of Cine participă's bar). These are
 * utilities because Tailwind's are `important` — a rule in calendar.css lost
 * to the outline variant, so a chosen "Nu particip" looked unchosen. The fill
 * stays while the answer saves; a disabled button otherwise turns grey (#842).
 */
const CHOSEN: Record<EventRsvpStatus, string> = {
  going:
    'cursor-default hover:bg-primary hover:text-primary-foreground active:bg-primary active:text-primary-foreground disabled:border-transparent disabled:bg-primary disabled:text-primary-foreground data-disabled:border-transparent data-disabled:bg-primary data-disabled:text-primary-foreground',
  declined:
    'cursor-default border-foreground bg-foreground text-background hover:bg-foreground hover:text-background dark:border-foreground dark:bg-foreground dark:hover:bg-foreground disabled:border-foreground disabled:bg-foreground disabled:text-background data-disabled:border-foreground data-disabled:bg-foreground data-disabled:text-background',
};

const LABELS: Record<EventRsvpStatus, string> = {
  going: 'Particip',
  declined: 'Nu particip',
};

export default function EventRsvpControls({
  eventId,
  eventTitle,
}: EventRsvpControlsProps) {
  const rsvp = useEventRsvp(eventId);
  const mutation = useSetEventRsvp();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState<EventRsvpStatus | null>(null);
  // A second tap can land before React re-renders the disabled buttons.
  const inFlight = useRef(false);
  const busy = saving !== null || mutation.isPending;
  const controlsDisabled = rsvp.isPending || rsvp.isError || busy;
  const answer = rsvp.data?.status;

  async function save(status: EventRsvpStatus) {
    if (controlsDisabled || inFlight.current) return;
    // The answer already chosen sends nothing; it says so instead.
    if (status === answer) {
      setFeedback({ kind: 'kept', message: keptMessage(status) });
      return;
    }

    inFlight.current = true;
    setSaving(status);
    setFeedback(null);
    try {
      await mutation.mutateAsync({ eventId, status });
      setFeedback({ kind: 'saved', message: savedMessage(status, eventTitle) });
    } catch (error) {
      setFeedback({ kind: 'error', message: mutationErrorMessage(error) });
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
  }

  return (
    <section className="event-rsvp" aria-label={`Răspuns pentru ${eventTitle}`}>
      <div className="event-rsvp-head">
        <p className="event-rsvp-prompt">Participi?</p>
        {(rsvp.isPending || rsvp.isError) && (
          <span className="event-rsvp-state">
            {rsvp.isPending ? 'Se încarcă răspunsul…' : 'Răspuns indisponibil'}
          </span>
        )}
      </div>

      <div
        className="event-rsvp-actions"
        role="group"
        aria-label="Alege răspunsul"
        aria-busy={busy ? 'true' : 'false'}
      >
        {(['going', 'declined'] as const).map((status) => {
          const chosen = answer === status;
          return (
            <Button
              key={status}
              type="button"
              // Particip chosen is the primary button; Nu particip chosen
              // keeps the outline's shape, filled in ink.
              variant={chosen && status === 'going' ? 'default' : 'outline'}
              className={cn('event-rsvp-button', chosen && CHOSEN[status])}
              disabled={controlsDisabled}
              // Focus stays on the tapped button while its answer saves.
              focusableWhenDisabled
              aria-pressed={chosen ? 'true' : 'false'}
              onClick={() => void save(status)}
            >
              {saving === status ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : chosen ? (
                <Check
                  data-icon="inline-start"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              ) : null}
              {LABELS[status]}
            </Button>
          );
        })}
      </div>

      {/* Seen and announced: the live region stays mounted so each new
          sentence is read out, and takes no room while it is empty. */}
      <p
        className={cn(
          'event-rsvp-receipt',
          feedback?.kind === 'kept' && 'is-kept',
        )}
        role="status"
      >
        {busy ? (
          <span className="sr-only">Se salvează răspunsul…</span>
        ) : feedback && feedback.kind !== 'error' ? (
          <>
            {feedback.kind === 'saved' && (
              <Check
                className="event-rsvp-receipt-icon"
                strokeWidth={3}
                aria-hidden="true"
              />
            )}
            {feedback.message}
          </>
        ) : null}
      </p>

      {/* An error is seen and announced at once. */}
      {feedback?.kind === 'error' && (
        <p className="event-rsvp-live is-error" role="alert">
          {feedback.message}
        </p>
      )}
    </section>
  );
}
