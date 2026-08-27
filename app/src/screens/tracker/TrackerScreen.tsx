import React, { Suspense, useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSpinner,
  IonText,
  IonButton,
} from '@ionic/react';
import { useMyTasks } from '../../queries/tasks';
import { mapTask } from '../../lib/task-mapper';
import { TaskCard } from '../../components/TaskCard';

// Lazy load the AG Grid wrapper for desktop
const TaskGrid = React.lazy(() => import('../../components/TaskGrid'));

export default function TrackerScreen() {
  const { data, error, isLoading, refetch } = useMyTasks();

  const presentationTasks = useMemo(() => {
    return data ? data.map(mapTask) : [];
  }, [data]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Taskurile mele</IonTitle>
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
              <h2>A apărut o eroare la încărcarea taskurilor.</h2>
              <p>Vă rugăm să încercați din nou.</p>
            </IonText>
            <IonButton onClick={() => refetch()}>Reîncearcă</IonButton>
          </div>
        )}

        {!isLoading && !error && presentationTasks.length === 0 && (
          <div className="ion-text-center ion-padding" data-testid="empty-state">
            <IonText color="medium">
              <p>Nu ai niciun task asignat.</p>
            </IonText>
          </div>
        )}

        {!isLoading && !error && presentationTasks.length > 0 && (
          <div data-testid="success-state">
            {/* Desktop View (AG Grid) - Hidden on medium and down */}
            <div className="ion-hide-md-down">
              <Suspense fallback={<div className="ion-text-center"><IonSpinner /></div>}>
                <TaskGrid tasks={presentationTasks} />
              </Suspense>
            </div>

            {/* Mobile View (Cards) - Hidden on large and up */}
            <div className="ion-hide-lg-up">
              {presentationTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
