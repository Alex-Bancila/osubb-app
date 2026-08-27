import {
  IonCard,
  IonCardTitle,
  IonCardContent,
  IonBadge,
  IonItem,
  IonLabel,
  IonNote,
} from '@ionic/react';
import type { PresentationTask } from '../lib/task-mapper';

const statusColorMap: Record<string, string> = {
  todo: 'medium',
  progress: 'primary',
  done: 'success',
  overdue: 'danger',
  open: 'warning',
};

export function TaskCard({ task }: { task: PresentationTask }) {
  const color = statusColorMap[task.statusRaw] || 'medium';

  return (
    <IonCard>
      <IonItem lines="none">
        <IonLabel className="ion-text-wrap">
          <IonCardTitle style={{ fontSize: '1.1rem' }}>{task.title}</IonCardTitle>
          <p style={{ marginTop: '0.25rem' }}>
            {task.deptId ? task.deptId.toUpperCase() : 'FĂRĂ DEPT'} • {task.pointsLabel}
          </p>
        </IonLabel>
      </IonItem>
      <IonCardContent style={{ paddingTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
          <IonNote>
            <strong>Termen:</strong> {task.deadlineLabel}
          </IonNote>
          <IonBadge color={color}>{task.statusLabel}</IonBadge>
        </div>
      </IonCardContent>
    </IonCard>
  );
}
