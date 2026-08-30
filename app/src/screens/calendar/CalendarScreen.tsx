import { IonContent, IonPage } from '@ionic/react';

import { Empty, ErrorState, Loading } from '../../components/states';
import { useUpcomingEvents } from '../../queries/events';
import { useDepartments } from '../../queries/reference';
import { groupUpcomingEvents } from './calendar-presentation';
import EventCard from './EventCard';

export default function CalendarScreen() {
  const events = useUpcomingEvents();
  const departments = useDepartments();
  const groups = groupUpcomingEvents(events.data ?? []);

  return (
    <IonPage>
      <IonContent>
        <div className="page calendar-page">
          <header className="page-head calendar-head">
            <p className="calendar-kicker">Agenda OSUBB</p>
            <h1 className="page-title">Ce urmează</h1>
            <p className="calendar-intro">
              Întâlnirile, activitățile și deadline-urile vizibile pentru tine.
            </p>
          </header>

          {events.isPending ? (
            <Loading label="Se încarcă evenimentele…" />
          ) : events.isError ? (
            <ErrorState
              error={events.error}
              text="Nu am putut încărca evenimentele."
              onRetry={() => void events.refetch()}
            />
          ) : groups.length === 0 ? (
            <Empty text="Nu sunt evenimente viitoare pentru tine." />
          ) : (
            <div className="calendar-agenda" aria-label="Evenimente viitoare">
              {groups.map((group) => {
                const headingId = `calendar-day-${group.dayKey}`;

                return (
                  <section
                    key={group.dayKey}
                    className="calendar-day"
                    aria-labelledby={headingId}
                  >
                    <header className="calendar-day-head">
                      <span className="calendar-day-rule" aria-hidden="true" />
                      <h2 id={headingId}>
                        <time dateTime={group.dayKey}>{group.dayLabel}</time>
                      </h2>
                      <span className="calendar-day-count">
                        {group.events.length}{' '}
                        {group.events.length === 1 ? 'eveniment' : 'evenimente'}
                      </span>
                    </header>

                    <ol className="calendar-event-list">
                      {group.events.map((event) => (
                        <li key={event.id}>
                          <EventCard
                            event={event}
                            departments={departments.data}
                          />
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
