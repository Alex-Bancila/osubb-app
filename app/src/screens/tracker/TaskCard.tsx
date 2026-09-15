import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '../../components/ui/card';
import { formatPoints } from '../../lib/format';
import type { TaskPresentation } from './task-presentation';
import type { TaskProgressAction } from '../../queries/task-progress';
import { TaskInterestControls } from './TaskInterestControls';
import { TaskQueueStatus } from './TaskQueueStatus';
import { TaskStageSummary } from './TaskStageSummary';

type TaskCardProps = {
  task: TaskPresentation;
  allowInterest?: boolean;
  memberId: string | undefined;
  pending: boolean;
  onProgress: (taskId: number, action: TaskProgressAction) => Promise<unknown>;
};

export function TaskCard({
  task,
  allowInterest = false,
  memberId,
  pending,
  onProgress,
}: TaskCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = `task-${task.id}-title`;
  const action =
    task.kind === 'task' && memberId && task.executor?.memberId === memberId
      ? task.status === 'todo'
        ? 'start'
        : task.status === 'in_progress'
          ? 'submit'
          : null
      : null;

  async function progress() {
    if (!action || pending || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onProgress(task.id, action);
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
    <article aria-labelledby={titleId} className="min-w-0">
      <Card
        className={
          task.overdue ? 'h-full border-l-4 border-l-destructive' : 'h-full'
        }
      >
        <CardHeader className="min-w-0 gap-3">
          <p className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className="mt-1 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: task.origin.color ?? 'var(--red)' }}
            />
            <span className="min-w-0 wrap-anywhere">{task.origin.label}</span>
          </p>
          <h2 id={titleId} className="text-lg font-semibold wrap-anywhere">
            {task.title}
          </h2>
          {task.parent && (
            <p className="text-sm wrap-anywhere">
              Subtask din: {task.parent.title}
            </p>
          )}
          {task.campaign && (
            <p className="text-sm wrap-anywhere">
              Campanie: {task.campaign.name}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                task.status === 'unfulfilled' ? 'destructive' : 'outline'
              }
            >
              {task.statusLabel}
            </Badge>
            {task.overdue && (
              <Badge variant="destructive">Termen depășit</Badge>
            )}
            {task.feedbackPending && (
              <Badge variant="secondary">Modificări cerute</Badge>
            )}
            {task.completedLate && (
              <Badge variant="secondary">Finalizat cu întârziere</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">Termen: </span>
            {task.deadline ? (
              <time dateTime={task.deadline}>
                {task.deadlineLabel} (ora României)
              </time>
            ) : (
              task.deadlineLabel
            )}
          </p>
          {task.description && (
            <p className="text-sm whitespace-pre-wrap wrap-anywhere">
              {task.description}
            </p>
          )}
          {task.assignmentMode !== 'public' && <TaskStageSummary task={task} />}
          {task.assignmentMode === 'public' &&
            (allowInterest &&
            !task.queueClosed &&
            ['todo', 'in_progress', 'in_review'].includes(task.status) ? (
              <TaskInterestControls taskId={task.id} task={task} />
            ) : (
              <TaskQueueStatus taskId={task.id} task={task} />
            ))}
          {task.points !== null && (
            <p className="text-sm">
              {formatPoints(task.points)} puncte · Dificultate {task.difficulty}{' '}
              · Nota {task.rating}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        {action && (
          <CardFooter className="mt-auto">
            <Button
              className="min-h-11 min-w-11 w-full whitespace-normal sm:w-auto"
              disabled={pending || saving}
              onClick={progress}
            >
              {pending || saving
                ? 'Se salvează…'
                : action === 'start'
                  ? 'Începe taskul'
                  : 'Trimite la verificare'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </article>
  );
}
