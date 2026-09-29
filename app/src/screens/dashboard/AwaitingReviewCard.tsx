import { EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
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
 *
 * The count is a badge on the title, as the navigation's unread counts are,
 * never a description line: a second header line put this title about
 * 22 px above its row neighbour's and its action on another line (F-10,
 * #893). The header is then one line, like every other card's on Acasă.
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
      aria-label="De evaluat"
      title={
        task ? (
          <span className="inline-flex items-center gap-2">
            De evaluat
            <Badge variant="destructive" data-testid="awaiting-review-count">
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">
                {`${formatTaskCount(count)} așteaptă evaluarea ta`}
              </span>
            </Badge>
          </span>
        ) : (
          'De evaluat'
        )
      }
      className={className}
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
