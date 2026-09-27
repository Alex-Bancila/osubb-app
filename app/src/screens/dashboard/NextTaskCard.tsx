import { ListTodo } from 'lucide-react';
import { EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { useAuth } from '../../lib/auth';
import { useMyTasks } from '../../queries/tasks';
import { TaskCard } from '../tracker/TaskCard';
import { toTaskPresentation } from '../tracker/task-presentation';
import { nextOwnTask } from './next-items';

/**
 * **Următorul task** (#700, ruling R4): the Member's soonest-deadline Task in
 * work, from the Tracker's own read, drawn with the Tracker's own card. The
 * card here is for reading — acting on the Task happens in Taskuri, where the
 * link opens it (`/tracker?task=<id>`), so the card carries no actions and no
 * `task-<id>` anchor of its own. The link appears only with a Task, because
 * it opens that Task.
 */
export default function NextTaskCard({
  now,
  className,
}: {
  now: Date;
  className?: string;
}) {
  const tasks = useMyTasks();
  const memberId = useAuth().session?.user.id;
  const next =
    tasks.data && memberId ? nextOwnTask(tasks.data, memberId) : null;

  return (
    <Panel
      eyebrow="Taskuri"
      icon={ListTodo}
      title="Următorul task"
      className={className}
      action={
        next
          ? { to: `/tracker?task=${next.id}`, label: 'Vezi în Taskuri' }
          : undefined
      }
      bare={Boolean(next)}
      boxClassName={next ? '*:flex-1' : undefined}
    >
      {tasks.isPending ? (
        <Loading />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : next ? (
        <TaskCard
          task={toTaskPresentation(next, now)}
          titleLevel={3}
          anchor={false}
          memberId={memberId}
        />
      ) : (
        <EmptyState>Niciun task cu termen în lucru.</EmptyState>
      )}
    </Panel>
  );
}
