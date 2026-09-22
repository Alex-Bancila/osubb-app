import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  TaskAssignmentError,
  useTaskAssignment,
} from '../../queries/task-assignment';
import { DirectExecutorSelector } from './DirectExecutorSelector';
import { isTerminalTask, type TaskStatus } from './task-presentation';

export function TaskAssignControl({
  taskId,
  groupId,
  status,
  kind,
  assignmentMode,
  hasExecutor,
  canManage,
}: {
  taskId: number;
  groupId: number;
  status: TaskStatus;
  kind: string;
  assignmentMode: string | null;
  hasExecutor: boolean;
  canManage: boolean;
}) {
  const mutation = useTaskAssignment();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  const receipt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (success) receipt.current?.focus();
  }, [success]);
  const canAssign =
    canManage &&
    kind === 'task' &&
    assignmentMode === 'direct' &&
    !hasExecutor &&
    !isTerminalTask(status);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canAssign || !memberId || submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ taskId, memberId });
      setOpen(false);
      setMemberId(null);
      setSuccess(true);
    } catch (failure) {
      setError(
        failure instanceof TaskAssignmentError
          ? failure.message
          : 'Nu am putut atribui taskul. Încearcă din nou.',
      );
    } finally {
      submitting.current = false;
    }
  }
  if (!canAssign && !success) return null;
  return (
    <section aria-label="Atribuirea executorului" className="space-y-3">
      {success && (
        <p ref={receipt} role="status" tabIndex={-1}>
          Executorul a fost atribuit.
        </p>
      )}
      {canAssign && (
        <div className="space-y-2">
          <p className="text-sm">Taskul nu are un executor.</p>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (mutation.isPending) return;
              setOpen(next);
              if (next) {
                setSuccess(false);
                setError(null);
              }
            }}
          >
            <Button type="button" onClick={() => setOpen(true)}>
              Atribuie
            </Button>
            {/* After a save, focus lands on the confirmation: the Atribuie
                button disappears once the Task has an Executor. */}
            <DialogContent finalFocus={() => receipt.current ?? true}>
              <form onSubmit={submit} className="grid gap-4">
                <DialogHeader>
                  <DialogTitle>Atribuie taskul</DialogTitle>
                  <DialogDescription>
                    Alege membrul care va lucra la acest task.
                  </DialogDescription>
                </DialogHeader>
                <DirectExecutorSelector
                  originGroupId={groupId}
                  value={memberId}
                  onChange={setMemberId}
                  disabled={mutation.isPending}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => setOpen(false)}
                  >
                    Renunță
                  </Button>
                  <Button
                    type="submit"
                    disabled={!memberId || mutation.isPending}
                  >
                    {mutation.isPending
                      ? 'Se atribuie…'
                      : 'Confirmă atribuirea'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  );
}
