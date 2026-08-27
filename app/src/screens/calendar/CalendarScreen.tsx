import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useUpcomingEvents, type EventRow } from '../../queries/events';
import { Empty, ErrorState, Loading } from '../../components/states';
import { formatDate } from '../../lib/format';
import {
  alertOutline,
  calendarOutline,
  flagOutline,
  megaphoneOutline,
  peopleOutline,
  starOutline,
  personAddOutline,
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

function EventLine({ event }: { event: EventRow }) {
  const isCall = event.type === 'call';
  const isDl = event.type === 'deadline';
  const deptClass = getDeptColorClass(event.dept_id);
  const timeStr =
    event.starts_at && event.starts_at.includes('T')
      ? event.starts_at.substring(11, 16)
      : '—';

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
    </div>
  );
}

export default function CalendarScreen() {
  const { data: events, isLoading, error, refetch } = useUpcomingEvents();

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
          <Empty text="Niciun eveniment viitor." />
        </IonContent>
      </IonPage>
    );
  }

  // Group events by local date string
  const groupedEvents: Record<string, EventRow[]> = {};
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
        <div className="page-head">
          <div>
            <h1 className="page-title">Calendar</h1>
            <p className="page-sub">Evenimente viitoare programate</p>
          </div>
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
      </IonContent>
    </IonPage>
  );
}
