import { useState } from 'react';
import { IonButton, IonSpinner, IonToast } from '@ionic/react';

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
        <span className="event-rsvp-state" aria-live="polite">
          {mutation.isPending ? (
            <>
              <IonSpinner name="crescent" aria-hidden="true" /> Se salvează…
            </>
          ) : rsvp.isPending ? (
            'Se încarcă răspunsul…'
          ) : rsvp.isError ? (
            'Răspuns indisponibil'
          ) : rsvp.data?.status === 'going' ? (
            'Ai răspuns: particip'
          ) : rsvp.data?.status === 'declined' ? (
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
        <IonButton
          className={
            rsvp.data?.status === 'going'
              ? 'event-rsvp-button is-going'
              : 'event-rsvp-button'
          }
          type="button"
          fill={rsvp.data?.status === 'going' ? 'solid' : 'outline'}
          disabled={controlsDisabled}
          aria-pressed={rsvp.data?.status === 'going' ? 'true' : 'false'}
          onClick={() => void save('going')}
        >
          Particip
        </IonButton>
        <IonButton
          className={
            rsvp.data?.status === 'declined'
              ? 'event-rsvp-button is-declined'
              : 'event-rsvp-button'
          }
          type="button"
          fill={rsvp.data?.status === 'declined' ? 'solid' : 'outline'}
          disabled={controlsDisabled}
          aria-pressed={rsvp.data?.status === 'declined' ? 'true' : 'false'}
          onClick={() => void save('declined')}
        >
          Nu particip
        </IonButton>
      </div>

      {feedback && (
        <p
          className="event-rsvp-live"
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}

      <IonToast
        isOpen={feedback !== null}
        message={feedback?.message}
        color={feedback?.kind === 'error' ? 'danger' : 'success'}
        duration={2800}
        position="bottom"
        htmlAttributes={{ 'aria-hidden': 'true' }}
        onDidDismiss={() => setFeedback(null)}
      />
    </section>
  );
}
