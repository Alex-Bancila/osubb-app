import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonIcon,
  IonLabel,
} from '@ionic/react';
import { locationOutline, timeOutline } from 'ionicons/icons';
import type { PresentationEvent } from '../lib/event-mapper';

const TYPE_COLORS: Record<string, string> = {
  sedinta: 'primary',
  activitate: 'secondary',
  call: 'tertiary',
  eveniment: 'success',
  deadline: 'danger',
  recrutare: 'warning',
};

const SCOPE_COLORS: Record<string, string> = {
  org: 'medium',
  dept: 'medium',
  project: 'medium',
  team: 'medium',
};

export function EventCard({ event }: { event: PresentationEvent }) {
  const typeColor = TYPE_COLORS[event.typeRaw] || 'medium';
  const scopeColor = SCOPE_COLORS[event.scopeRaw] || 'medium';

  return (
    <IonCard>
      <IonCardHeader style={{ paddingBottom: '0.5rem' }}>
        <IonCardTitle style={{ fontSize: '1.1rem' }}>{event.title}</IonCardTitle>
      </IonCardHeader>
      
      <IonCardContent>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--ion-color-medium)' }}>
          <IonIcon icon={timeOutline} style={{ marginRight: '0.5rem' }} />
          <span>{event.timeRangeLabel}</span>
        </div>
        
        {event.location && (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', color: 'var(--ion-color-medium)' }}>
            <IonIcon icon={locationOutline} style={{ marginRight: '0.5rem' }} />
            <span>{event.location}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <IonChip color={typeColor} style={{ margin: 0 }}>
            <IonLabel>{event.typeLabel}</IonLabel>
          </IonChip>
          <IonChip color={scopeColor} style={{ margin: 0 }} outline>
            <IonLabel>{event.scopeLabel}</IonLabel>
          </IonChip>
        </div>
      </IonCardContent>
    </IonCard>
  );
}
