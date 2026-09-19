import { Button } from '../../components/ui/button';
import { useSetTaskQueue } from '../../queries/task-queue-control';

export function TaskQueueControl({
  taskId,
  closed,
}: {
  taskId: number;
  closed: boolean;
}) {
  const mutation = useSetTaskQueue();
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {closed
          ? 'Coada este închisă. Redeschiderea permite candidaturi noi.'
          : 'Închiderea ascunde oportunitatea și închide candidaturile în așteptare. Istoricul participanților se păstrează.'}
      </p>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ taskId, open: closed })}
      >
        {mutation.isPending
          ? 'Se salvează…'
          : closed
            ? 'Deschide coada'
            : 'Închide coada'}
      </Button>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-sm">
          Starea cozii a fost actualizată.
        </p>
      )}
    </div>
  );
}
