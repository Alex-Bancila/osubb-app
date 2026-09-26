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
        <span className="event-rsvp-state">
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
          ) : answer === 'going' ? (
            'Ai răspuns: particip'
          ) : answer === 'declined' ? (
            'Ai răspuns: nu particip'
          ) : (
            'Nu ai răspuns încă'
          )}
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

      {/* One inline message, seen and announced alike: it replaced the Ionic
          toast, which needed a hidden twin for assistive technology. */}
      {feedback && (
        <p
          className={
            feedback.kind === 'error'
              ? 'event-rsvp-live is-error'
              : 'event-rsvp-live'
          }
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}
