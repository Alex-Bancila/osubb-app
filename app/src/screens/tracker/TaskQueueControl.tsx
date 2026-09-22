import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useSetTaskQueue } from '../../queries/task-queue-control';

// Closing the queue closes every pending Candidature for good (a reopen does
// not bring them back), so closing asks for confirmation; reopening does not.
export function TaskQueueControl({
  taskId,
  closed,
}: {
  taskId: number;
  closed: boolean;
}) {
  const mutation = useSetTaskQueue();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {closed
          ? 'Coada este închisă. Redeschiderea permite candidaturi noi.'
          : 'Coada este deschisă. Membrii își pot exprima interesul pentru acest task.'}
      </p>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={mutation.isPending}
        onClick={() =>
          closed ? mutation.mutate({ taskId, open: true }) : setConfirming(true)
        }
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
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Închizi coada?</DialogTitle>
            <DialogDescription>
              Taskul nu mai apare la oportunități, iar candidaturile în
              așteptare se închid. Cei înscriși primesc o notificare și, dacă
              redeschizi coada, trebuie să se înscrie din nou. Istoricul
              participanților se păstrează.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" className="min-h-11" />}
            >
              Renunță
            </DialogClose>
            <Button
              className="min-h-11"
              onClick={() => {
                setConfirming(false);
                mutation.mutate({ taskId, open: false });
              }}
            >
              Închide coada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
