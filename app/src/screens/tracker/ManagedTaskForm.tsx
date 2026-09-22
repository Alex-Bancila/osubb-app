import { Button } from '../../components/ui/button';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { TaskForm } from './TaskForm';
import type { TaskDraft } from './task-form-model';

export function ManagedTaskForm({
  onDraft,
  parentTaskId = null,
}: {
  onDraft: (draft: TaskDraft) => void;
  parentTaskId?: number | null;
}) {
  const query = useTaskFormOptions();
  if (query.isPending)
    return <p role="status">Se încarcă opțiunile taskului…</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-2">
        <p>Nu am putut încărca opțiunile taskului.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Reîncearcă
        </Button>
      </div>
    );
  return (
    <TaskForm
      key={parentTaskId ?? 'new-task'}
      options={query.data}
      onDraft={onDraft}
      parentTaskId={parentTaskId}
    />
  );
}
