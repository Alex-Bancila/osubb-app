import { IonContent, IonPage } from '@ionic/react';
import { useMyTasks } from '../../queries/tasks';
import { Empty, ErrorState, Loading } from '../../components/states';
import { formatDate } from '../../lib/format';

const STATUS_LABEL: Record<string, string> = {
  todo: 'De făcut',
  in_progress: 'În lucru',
  in_review: 'În verificare',
  completed: 'Finalizat',
  unfulfilled: 'Neîndeplinit',
  cancelled: 'Anulat',
};

/* Deliberately plain: it exists to show the query layer returning live data
   (#87). The shadcn + TanStack Table tracker (ADR-0002) with tabs, candidate
   queue and evaluation is #88–#92. */
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
                  {/* Difficulty, and the Rating once there is one. Points
                      moved onto the Evaluation with #317 and are not
                      readable from here yet (#164 rebuilds this screen
                      around them); showing a number this screen would have
                      to recompute from the scoring guide would be a second
                      copy of a rule the ledger already owns. */}
                  <span className="task-meta">
                    {task.difficulty === null
                      ? 'dificultate —'
                      : task.rating === null
                        ? `dificultate ${task.difficulty}`
                        : `dificultate ${task.difficulty} · nota ${task.rating}`}
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
