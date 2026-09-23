import { IonContent, IonPage } from '@ionic/react';

import { Empty, ErrorState, Loading } from '../../components/states';
import { useUpcomingEvents } from '../../queries/events';
import { useGroups } from '../../queries/reference';
import { groupUpcomingEvents } from './calendar-presentation';
import EventCard from './EventCard';
import { NewEventControl } from './NewEventControl';

export default function CalendarScreen() {
  const events = useUpcomingEvents();
  // The Event carries its own Group; this map is only how a Child Group's card
  // names its parent ("Echipă · Educațional").
  const groups = useGroups();
  const days = groupUpcomingEvents(events.data ?? []);

  return (
    <IonPage>
      <IonContent>
        <div className="page calendar-page">
          <header className="page-head calendar-head">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="calendar-kicker">Agenda OSUBB</p>
                <h1 className="page-title">Ce urmează</h1>
                <p className="calendar-intro">
                  Întâlnirile, activitățile și deadline-urile vizibile pentru
                  tine.
                </p>
              </div>
              <NewEventControl />
            </div>
          </header>

          {events.isPending ? (
            <Loading label="Se încarcă evenimentele…" />
          ) : events.isError ? (
            <ErrorState
              error={events.error}
              text="Nu am putut încărca evenimentele."
              onRetry={() => void events.refetch()}
            />
          ) : days.length === 0 ? (
            <Empty text="Nu sunt evenimente viitoare pentru tine." />
          ) : (
            <div className="calendar-agenda" aria-label="Evenimente viitoare">
              {days.map((day) => {
                const headingId = `calendar-day-${day.dayKey}`;

                return (
                  <section
                    key={day.dayKey}
                    className="calendar-day"
                    aria-labelledby={headingId}
                  >
                    <header className="calendar-day-head">
                      <span className="calendar-day-rule" aria-hidden="true" />
                      <h2 id={headingId}>
                        <time dateTime={day.dayKey}>{day.dayLabel}</time>
                      </h2>
                      <span className="calendar-day-count">
                        {day.events.length}{' '}
                        {day.events.length === 1 ? 'eveniment' : 'evenimente'}
                      </span>
                    </header>

                    <ol className="calendar-event-list">
                      {day.events.map((event) => (
                        <li key={event.id}>
                          <EventCard event={event} groups={groups.data} />
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
