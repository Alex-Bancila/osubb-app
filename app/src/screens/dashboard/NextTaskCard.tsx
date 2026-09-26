import { ListTodo } from 'lucide-react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useAuth } from '../../lib/auth';
import { useMyTasks } from '../../queries/tasks';
import { TaskCard } from '../tracker/TaskCard';
import { toTaskPresentation } from '../tracker/task-presentation';
import { nextOwnTask } from './next-items';
import { NextPlaceholder, NextSlot } from './NextSlot';

/**
 * **Următorul task** (#700, ruling R4): the Member's soonest-deadline Task in
 * work, from the Tracker's own read, drawn with the Tracker's own card. The
 * card here is for reading — acting on the Task happens in Taskuri, where the
 * link opens it (`/tracker?task=<id>`), so the card carries no actions and no
 * `task-<id>` anchor of its own.
 */
export default function NextTaskCard({ now }: { now: Date }) {
  const tasks = useMyTasks();
  const memberId = useAuth().session?.user.id;
  const next =
    tasks.data && memberId ? nextOwnTask(tasks.data, memberId) : null;

  return (
    <NextSlot
      title="Următorul task"
      icon={ListTodo}
      link={
        next && { to: `/tracker?task=${next.id}`, label: 'Vezi în Taskuri' }
      }
    >
      {tasks.isPending ? (
        <NextPlaceholder>
          <Loading />
        </NextPlaceholder>
      ) : tasks.isError ? (
        <NextPlaceholder>
          <ErrorState
            error={tasks.error}
            onRetry={() => void tasks.refetch()}
          />
        </NextPlaceholder>
      ) : next ? (
        <TaskCard
          task={toTaskPresentation(next, now)}
          titleLevel={3}
          anchor={false}
          memberId={memberId}
        />
      ) : (
        <NextPlaceholder>
          <Empty text="Niciun task cu termen în lucru." />
        </NextPlaceholder>
      )}
    </NextSlot>
  );
}
