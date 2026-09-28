import { EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { formatTaskCount } from '../../lib/format';
import { useAwaitingMyReview } from '../../queries/task-review';
import { TaskCard } from '../tracker/TaskCard';
import { toTaskPresentation } from '../tracker/task-presentation';

/**
 * **De evaluat** (#822, ruling R27): the In-review Task submitted longest ago
 * that the viewer may evaluate, and how many are waiting. Rendered only for
 * a viewer with `manageTasks` — the page decides. `Evaluează` opens Taskuri
 * on De gestionat with the Task's details sheet, where the Evaluation
 * control is; the card itself only reads. No eyebrow: the title and its
 * link already say where it lives (B7).
 */
export default function AwaitingReviewCard({
  now,
  className,
}: {
  now: Date;
  className?: string;
}) {
  const review = useAwaitingMyReview(true);
  const task = review.data?.task ?? null;
  const count = review.data?.count ?? 0;

  return (
    <Panel
      title="De evaluat"
      className={className}
      description={
        task ? `${formatTaskCount(count)} așteaptă evaluarea ta` : undefined
      }
      action={
        task
          ? { to: `/tracker?task=${task.id}`, label: 'Evaluează' }
          : undefined
      }
      bare={Boolean(task)}
      boxClassName={task ? '*:flex-1' : undefined}
    >
      {review.isError ? (
        <ErrorState error={review.error} onRetry={review.refetch} />
      ) : review.isPending ? (
        <Loading />
      ) : task ? (
        <TaskCard
          task={toTaskPresentation(task, now)}
          titleLevel={3}
          anchor={false}
        />
      ) : (
        <EmptyState>Niciun task nu așteaptă evaluarea ta.</EmptyState>
      )}
    </Panel>
  );
}
