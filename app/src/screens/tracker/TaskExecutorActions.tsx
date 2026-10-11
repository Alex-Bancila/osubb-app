import { useState, type ElementType } from 'react';
import { Play } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { TaskProgressInput } from '../../queries/task-progress';
import { TaskActionSuccess } from './TaskActionSuccess';
import { TaskGiveUpControl } from './TaskGiveUpControl';
import { gaveUpReceipt, type OnGaveUp } from './give-up-receipt';
import { useReceiptTurn } from './receipt-turn';
import { SubmitForReviewDialog } from './SubmitForReviewDialog';
import type { TaskPresentation } from './task-presentation';

/**
 * What the Executor does with their own Task — Începe taskul, Trimite la
 * verificare, Renunță la task — and the receipt or the error those leave.
 * The one place for the rule (only the Member who holds the Task now, and
 * only before review), drawn at a Task row's end and in the details
 * sheet. With nothing to offer and nothing to say it draws nothing.
 */
export function TaskExecutorActions({
  task,
  memberId,
  pending = false,
  onProgress,
  onGaveUp,
  as: Wrapper = 'div',
  className,
  messagesClassName,
}: {
  task: TaskPresentation;
  memberId: string | undefined;
  pending?: boolean;
  onProgress: ((input: TaskProgressInput) => Promise<unknown>) | undefined;
  /** The list shows the give-up receipt; without it the receipt stays here. */
  onGaveUp?: OnGaveUp | undefined;
  /** The element around the buttons. */
  as?: ElementType;
  className?: string;
  /** Around the receipt and the error, which sit above the buttons. */
  messagesClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNoticeState] = useState<string | null>(null);
  const noticeTurn = useReceiptTurn();
  const setNotice = (text: string | null) => {
    setNoticeState(text);
    if (text) noticeTurn.claim();
  };
  const isExecutor =
    onProgress !== undefined &&
    task.kind === 'task' &&
    memberId !== undefined &&
    task.executor?.memberId === memberId &&
    // Who finished a Task (#861) no longer holds it: no actions.
    task.executor.isCurrent;
  const action = isExecutor
    ? task.status === 'todo'
      ? 'start'
      : task.status === 'in_progress'
        ? 'submit'
        : null
    : null;
  const canGiveUp =
    isExecutor && (task.status === 'todo' || task.status === 'in_progress');
  const shownNotice = notice && noticeTurn.current ? notice : null;

  async function start() {
    if (pending || saving || !onProgress) return;
    setSaving(true);
    setError(null);
    try {
      await onProgress({ taskId: task.id, action: 'start' });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Nu am putut salva schimbarea. Încearcă din nou.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {(shownNotice || error) && (
        <div className={messagesClassName}>
          {shownNotice && <TaskActionSuccess>{shownNotice}</TaskActionSuccess>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      {(action || canGiveUp) && (
        <Wrapper className={className}>
          {action === 'start' && (
            <Button
              className="min-h-11 w-full whitespace-normal"
              disabled={pending || saving}
              onClick={start}
            >
              <Play aria-hidden="true" />
              {pending || saving ? 'Se salvează…' : 'Începe taskul'}
            </Button>
          )}
          {action === 'submit' && onProgress && (
            <SubmitForReviewDialog
              pending={pending}
              onSubmit={(submission) =>
                onProgress({
                  taskId: task.id,
                  action: 'submit',
                  ...submission,
                })
              }
              onSuccess={() => setNotice('Taskul a fost trimis la verificare.')}
            />
          )}
          {canGiveUp && (
            <TaskGiveUpControl
              taskId={task.id}
              assignmentMode={task.assignmentMode}
              onGaveUp={() => {
                // The list shows the receipt when it holds the row; with no
                // list (the details sheet) it stays here, since the control
                // leaves with the Executor's actions (Audit D-3).
                const receipt = gaveUpReceipt(task.assignmentMode);
                if (onGaveUp) onGaveUp(task.id, receipt);
                else setNotice(receipt);
              }}
            />
          )}
        </Wrapper>
      )}
    </>
  );
}
