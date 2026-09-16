import { useEffect, useState } from 'react';
import { useMyTasks } from '../../queries/tasks';
import { useTaskProgress } from '../../queries/task-progress';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { TaskCard } from './TaskCard';
import { toTaskPresentation } from './task-presentation';

export default function TrackerScreen() {
  const tasks = useMyTasks();
  const progress = useTaskProgress();
  const { session } = useAuth();
  const [now, setNow] = useState(() => new Date());
  // Derived overdue badges advance while the screen stays open, without reads.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6"
      aria-labelledby="my-tasks-title"
    >
      <header className="space-y-2">
        <h1 id="my-tasks-title" className="text-2xl font-semibold">
          Taskurile mele
        </h1>
        <p className="text-muted-foreground">
          Lucrul tău de acum și taskurile la care ai contribuit.
        </p>
      </header>
      {tasks.isPending ? (
        <p role="status">Se încarcă taskurile…</p>
      ) : tasks.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca taskurile.</p>
          <Button
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={() => tasks.refetch()}
          >
            Încearcă din nou
          </Button>
        </div>
      ) : tasks.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nu ai niciun task atribuit încă.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid min-w-0 list-none gap-4 p-0 md:grid-cols-2">
          {tasks.data.map((row) => (
            <li key={row.id} className="min-w-0">
              <TaskCard
                task={toTaskPresentation(row, now)}
                memberId={session?.user.id}
                pending={
                  progress.isPending && progress.variables?.taskId === row.id
                }
                onProgress={(taskId, action) =>
                  progress.mutateAsync({ taskId, action })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
