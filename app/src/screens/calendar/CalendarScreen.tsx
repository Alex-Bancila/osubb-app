import { useState } from 'react';
import { IonPage, IonContent, IonIcon, IonButton } from '@ionic/react';
import {
  useUpcomingEvents,
  useRsvpMutation,
  type UpcomingEvent,
} from '../../queries/events';
import { Empty, ErrorState, Loading } from '../../components/states';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { AddEventModal } from './components/AddEventModal';
import {
  alertOutline,
  calendarOutline,
  flagOutline,
  megaphoneOutline,
  peopleOutline,
  starOutline,
  personAddOutline,
  addOutline,
  checkmarkOutline,
} from 'ionicons/icons';

function getEventIcon(type: string) {
  switch (type) {
    case 'deadline':
      return flagOutline;
    case 'call':
      return megaphoneOutline;
    case 'recrutare':
      return personAddOutline;
    case 'sedinta':
      return peopleOutline;
    case 'eveniment':
      return starOutline;
    default:
      return calendarOutline;
  }
}

function getDeptName(deptId: string | null) {
  if (!deptId) return 'Org';
  switch (deptId) {
    case 'edu':
      return 'Edu';
    case 'hr':
      return 'HR';
    case 'fin':
      return 'Fin';
    case 'pr':
      return 'PR';
    case 'youth':
      return 'Tineret';
    default:
      return deptId;
  }
}

// Map dept to CSS custom properties according to token colors, or we can use mockup classes
function getDeptColorClass(deptId: string | null) {
  if (!deptId) return 'dept-org';
  return `dept-${deptId}`;
}

function EventLine({ event }: { event: UpcomingEvent }) {
  const { mutate: rsvp } = useRsvpMutation();
  const isCall = event.type === 'call';
  const isDl = event.type === 'deadline';
  const deptClass = getDeptColorClass(event.dept_id);
  const timeStr =
    event.starts_at && event.starts_at.includes('T')
      ? event.starts_at.substring(11, 16)
      : '—';

  const attendance = event.event_attendance?.[0];
  const isGoing = attendance?.status === 'going';
  const isDeclined = attendance?.status === 'declined';

  return (
    <div
      className={`list-row clickable`}
      style={
        isDl
          ? { background: 'var(--danger-050)', borderRadius: 'var(--r-sm)' }
          : undefined
      }
    >
      <div className={`list-lead ${deptClass}-bg-subtle`}>
        <IonIcon icon={getEventIcon(event.type)} style={{ fontSize: '20px' }} />
      </div>
      <div className="list-main">
        <div className="row gap-2">
          <span className="list-title truncate">{event.title}</span>
          {isCall && (
            <span className="badge badge--purple">
              <IonIcon
                icon={megaphoneOutline}
                style={{ fontSize: '11px', marginRight: '4px' }}
              />
              call
            </span>
          )}
          {isDl && (
            <span className="badge badge--red">
              <IonIcon
                icon={alertOutline}
                style={{ fontSize: '11px', marginRight: '4px' }}
              />
              deadline
            </span>
          )}
        </div>
        <div className="list-meta">
          <span className={`tag tag--soft ${deptClass}`}>
            {getDeptName(event.dept_id)}
          </span>
          <span>{timeStr !== '—' ? timeStr : '—'}</span>
        </div>
      </div>

      {!isDl && (
        <div
          className="list-side"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            alignItems: 'flex-end',
          }}
        >
          {event.capacity != null && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--gray-500)',
                fontWeight: 500,
              }}
            >
              Cap: {event.capacity}
            </span>
          )}
          {isGoing ? (
            <span
              className="badge badge--green"
              onClick={(e) => {
                e.stopPropagation();
                rsvp({ eventId: event.id, status: 'declined' });
              }}
            >
              <IonIcon icon={checkmarkOutline} style={{ marginRight: '4px' }} />{' '}
              Vin
            </span>
          ) : isDeclined ? (
            <span
              className="badge badge--red"
              onClick={(e) => {
                e.stopPropagation();
                rsvp({ eventId: event.id, status: 'going' });
              }}
            >
              Nu vin
            </span>
          ) : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  rsvp({ eventId: event.id, status: 'going' });
                }}
              >
                Vin
              </button>
              <button
                className="btn btn-outline btn-sm"
                style={{
                  color: 'var(--danger-500)',
                  borderColor: 'var(--danger-200)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  rsvp({ eventId: event.id, status: 'declined' });
                }}
              >
                Nu
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarScreen() {
  const { data: events, isLoading, error, refetch } = useUpcomingEvents();
  const { claims } = useAuth();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const seesAllEvents = can(claims, 'seeAllEvents');

  if (isLoading) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <Loading />
        </IonContent>
      </IonPage>
    );
  }

  if (error) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <ErrorState onRetry={refetch} />
        </IonContent>
      </IonPage>
    );
  }

  if (!events || events.length === 0) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div
            className="page-head"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h1 className="page-title">Calendar</h1>
              <p className="page-sub">Evenimente viitoare programate</p>
            </div>
            {seesAllEvents && (
              <IonButton onClick={() => setIsAddModalOpen(true)}>
                <IonIcon slot="start" icon={addOutline} />
                Adaugă activitate
              </IonButton>
            )}
          </div>
          <Empty text="Niciun eveniment viitor." />
          <AddEventModal
            isOpen={isAddModalOpen}
            onDidDismiss={() => setIsAddModalOpen(false)}
          />
        </IonContent>
      </IonPage>
    );
  }

  // Group events by local date string
  const groupedEvents: Record<string, UpcomingEvent[]> = {};
  events.forEach((event) => {
    // get just the date part for grouping
    const datePart = event.starts_at
      ? event.starts_at.slice(0, 10)
      : 'Fără dată';
    if (!groupedEvents[datePart]) {
      groupedEvents[datePart] = [];
    }
    groupedEvents[datePart].push(event);
  });

  const dates = Object.keys(groupedEvents).sort();

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div
          className="page-head"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h1 className="page-title">Calendar</h1>
            <p className="page-sub">
              {seesAllEvents
                ? 'Toate evenimentele organizației.'
                : 'Evenimentele viitoare la care ai acces.'}
            </p>
          </div>
          {seesAllEvents && (
            <IonButton onClick={() => setIsAddModalOpen(true)}>
              <IonIcon slot="start" icon={addOutline} />
              Adaugă activitate
            </IonButton>
          )}
        </div>

        <div className="col gap-5">
          {dates.map((dateStr) => {
            const dayEvents = groupedEvents[dateStr];
            const dateLabel =
              dateStr === 'Fără dată' ? dateStr : formatDate(dateStr);

            return (
              <div key={dateStr} className="card">
                <div className="card-head">
                  <span className="card-title">
                    <IonIcon
                      icon={calendarOutline}
                      style={{ fontSize: '18px', marginRight: '8px' }}
                    />
                    {dateLabel}
                  </span>
                  <span className="badge badge--soft">{dayEvents.length}</span>
                </div>
                <div
                  className="card-body"
                  style={{
                    paddingTop: 'var(--s-2)',
                    paddingBottom: 'var(--s-3)',
                  }}
                >
                  <div className="list">
                    {dayEvents.map((ev) => (
                      <EventLine key={ev.id} event={ev} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <AddEventModal
          isOpen={isAddModalOpen}
          onDidDismiss={() => setIsAddModalOpen(false)}
        />
      </IonContent>
    </IonPage>
  );
}
