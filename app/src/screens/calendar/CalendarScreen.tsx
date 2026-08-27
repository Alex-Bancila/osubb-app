import React, { useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSpinner,
  IonText,
  IonButton,
  IonList,
  IonListHeader,
  IonLabel,
} from '@ionic/react';
import { useUpcomingEvents } from '../../queries/events';
import { mapEvent, groupEventsByDay } from '../../lib/event-mapper';
import { EventCard } from '../../components/EventCard';

export default function CalendarScreen() {
  const { data, error, isLoading, refetch } = useUpcomingEvents();

  const groupedEvents = useMemo(() => {
    if (!data) return [];
    const presentationEvents = data.map(mapEvent);
    return groupEventsByDay(presentationEvents);
  }, [data]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Calendar</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      <IonContent className="ion-padding">
        {isLoading && (
          <div className="ion-text-center ion-padding" data-testid="loading-state">
            <IonSpinner name="crescent" />
          </div>
        )}

        {error && (
          <div className="ion-text-center ion-padding" data-testid="error-state">
            <IonText color="danger">
              <h2>A apărut o eroare la încărcarea calendarului.</h2>
            </IonText>
            <IonButton onClick={() => refetch()} style={{ marginTop: '1rem' }}>
              Reîncearcă
            </IonButton>
          </div>
        )}

        {!isLoading && !error && groupedEvents.length === 0 && (
          <div className="ion-text-center ion-padding" data-testid="empty-state">
            <IonText color="medium">
              <p>Nu există niciun eveniment programat.</p>
            </IonText>
          </div>
        )}

        {!isLoading && !error && groupedEvents.length > 0 && (
          <div data-testid="success-state">
            <IonList style={{ background: 'transparent' }}>
              {groupedEvents.map((group) => (
                <React.Fragment key={group.dateLabel}>
                  <IonListHeader style={{ paddingLeft: '4px' }}>
                    <IonLabel color="medium" style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
                      {group.dateLabel}
                    </IonLabel>
                  </IonListHeader>
                  
                  {group.events.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </React.Fragment>
              ))}
            </IonList>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
