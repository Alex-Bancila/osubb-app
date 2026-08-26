import { IonContent, IonPage } from '@ionic/react';
import { useMyTasks } from '../../queries/tasks';
import { Empty, ErrorState, Loading } from '../../components/states';
import { formatDate, formatPoints } from '../../lib/format';

const STATUS_LABEL: Record<string, string> = {
  todo: 'De făcut',
  progress: 'În lucru',
  done: 'Gata',
  overdue: 'Întârziat',
  open: 'Deschis',
};

/* Deliberately plain: it exists to show the query layer returning live data
   (#87). The AG Grid tracker with tabs, claiming and grading is #88–#92. */
export default function TrackerScreen() {
  const tasks = useMyTasks();

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <section className="card">
          <h2 className="card-title">Taskurile mele</h2>

          {tasks.isPending ? (
            <Loading />
          ) : tasks.isError ? (
            <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : tasks.data.length === 0 ? (
            <Empty text="Nu ai niciun task asignat acum." />
          ) : (
            <ul className="task-list">
              {tasks.data.map((task) => (
                <li key={task.id}>
                  <span className="task-title">{task.title}</span>
                  <span className={`chip chip--${task.status}`}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </span>
                  <span className="task-meta">{formatDate(task.deadline)}</span>
                  <span className="task-meta">
                    {task.rating === null
                      ? `dificultate ${task.difficulty}`
                      : `${formatPoints(task.points ?? 0)} p`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </IonContent>
    </IonPage>
  );
}
