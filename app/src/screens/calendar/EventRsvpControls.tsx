import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { Button } from '../../components/ui/button';
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
  kind: 'success' | 'error';
  message: string;
};

const UNKNOWN_ERROR = 'Nu am putut salva răspunsul. Încearcă din nou.';

function mutationErrorMessage(error: unknown): string {
  return error instanceof EventRsvpMutationError
    ? error.message
    : UNKNOWN_ERROR;
}

export default function EventRsvpControls({
  eventId,
  eventTitle,
}: EventRsvpControlsProps) {
  const rsvp = useEventRsvp(eventId);
  const mutation = useSetEventRsvp();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const controlsDisabled = rsvp.isPending || rsvp.isError || mutation.isPending;
  const answer = rsvp.data?.status;

  async function save(status: EventRsvpStatus) {
    if (controlsDisabled) return;

    setFeedback(null);
    try {
      await mutation.mutateAsync({ eventId, status });
      setFeedback({
        kind: 'success',
        message:
          status === 'going'
            ? 'Răspuns salvat: participi.'
            : 'Răspuns salvat: nu participi.',
      });
    } catch (error) {
      setFeedback({ kind: 'error', message: mutationErrorMessage(error) });
    }
  }

  return (
    <section className="event-rsvp" aria-label={`Răspuns pentru ${eventTitle}`}>
      <div className="event-rsvp-head">
        <p className="event-rsvp-prompt">Participi?</p>
        {/* The pressed button is the answer (B4): text shows here only while
            something is in flight or has gone wrong. The live region stays
            mounted, so a change of its words is announced; a saved answer
            is announced here without being shown. */}
        <span className="event-rsvp-state" role="status" aria-live="polite">
          {mutation.isPending ? (
            <>
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Se salvează…
            </>
          ) : rsvp.isPending ? (
            'Se încarcă răspunsul…'
          ) : rsvp.isError ? (
            'Răspuns indisponibil'
          ) : feedback?.kind === 'success' ? (
            <span className="sr-only">{feedback.message}</span>
          ) : null}
        </span>
      </div>

      <div
        className="event-rsvp-actions"
        role="group"
        aria-label="Alege răspunsul"
        aria-busy={mutation.isPending ? 'true' : 'false'}
      >
        <Button
          type="button"
          variant={answer === 'going' ? 'default' : 'outline'}
          className="event-rsvp-button"
          disabled={controlsDisabled}
          aria-pressed={answer === 'going' ? 'true' : 'false'}
          onClick={() => void save('going')}
        >
          Particip
        </Button>
        <Button
          type="button"
          variant="outline"
          className={
            answer === 'declined'
              ? 'event-rsvp-button is-declined'
              : 'event-rsvp-button'
          }
          disabled={controlsDisabled}
          aria-pressed={answer === 'declined' ? 'true' : 'false'}
          onClick={() => void save('declined')}
        >
          Nu particip
        </Button>
      </div>

      {/* An error is seen and announced at once. */}
      {feedback?.kind === 'error' && (
        <p className="event-rsvp-live is-error" role="alert">
          {feedback.message}
        </p>
      )}
    </section>
  );
}
