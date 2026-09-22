import { Button } from '../../components/ui/button';
import { useTaskEvaluationCapability } from '../../queries/task-review';

// Shared by the review actions: one query failure should produce one retry.
export function TaskReviewCapabilityNotice({ taskId }: { taskId: number }) {
  const capability = useTaskEvaluationCapability(taskId);
  if (capability.isPending)
    return <p role="status">Se verifică permisiunile de evaluare…</p>;
  if (capability.isError)
    return (
      <div role="alert" className="space-y-2">
        <p>Nu am putut verifica permisiunile de evaluare.</p>
        <Button
          className="min-h-11"
          disabled={capability.isFetching}
          onClick={() => void capability.refetch()}
        >
          Reîncearcă verificarea permisiunilor
        </Button>
      </div>
    );
  return null;
}
