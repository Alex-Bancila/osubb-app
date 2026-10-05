import { useState } from 'react';
import {
  Consequences,
  DeleteForGoodDialog,
  type DeleteDialogControls,
} from '../../components/delete-for-good/DeleteForGoodDialog';
import {
  countLabel,
  NO_UNDO,
} from '../../components/delete-for-good/delete-text';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import { formatPointCount } from '../../lib/format';
import {
  DeleteRefusal,
  useDeleteTask,
  useTaskDeletePreview,
  type PointsAtStake,
} from '../../queries/delete-for-good';
import { useMemberIdentities } from '../../queries/member-identities';

import { taskDeletedReceipt } from './task-delete-receipt';

const FAILED = 'Nu am putut șterge taskul. Încearcă din nou.';

/**
 * **Șterge definitiv** in the Task details sheet (#1017), for the Task's
 * managers — the same people Anulează is offered to, in any status: a
 * finished Task is exactly the one that may hold points. The dialog reads
 * what the Task still holds; without points it asks once, with points it
 * names every Member and asks whether to take the points back.
 */
export function TaskDeleteControl({
  taskId,
  canManage,
  onDeleted,
}: {
  taskId: number;
  canManage: boolean;
  /** The Task is gone: close the sheet and leave this receipt on the list. */
  onDeleted: (receipt: string) => void;
}) {
  if (!canManage) return null;
  return (
    <DeleteForGoodDialog
      title="Ștergi definitiv taskul?"
      className="sm:ml-auto"
    >
      {(controls) => (
        <TaskDeleteBody
          taskId={taskId}
          controls={controls}
          onDeleted={onDeleted}
        />
      )}
    </DeleteForGoodDialog>
  );
}

function TaskDeleteBody({
  taskId,
  controls,
  onDeleted,
}: {
  taskId: number;
  controls: DeleteDialogControls;
  onDeleted: (receipt: string) => void;
}) {
  const preview = useTaskDeletePreview(taskId);
  const remove = useDeleteTask();
  // Points that appeared between the preview and the delete (the race).
  const [raced, setRaced] = useState<PointsAtStake | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(withPoints: boolean) {
    setError(null);
    controls.setBusy(true);
    try {
      const result = await remove.mutateAsync({ taskId, withPoints });
      controls.close(true);
      onDeleted(taskDeletedReceipt(result.pointsReversed));
    } catch (failure) {
      controls.setBusy(false);
      if (
        failure instanceof DeleteRefusal &&
        failure.reason === 'task_has_points' &&
        failure.points
      ) {
        setRaced(failure.points);
        return;
      }
      setError(describeFailure(failure, FAILED).message);
    }
  }

  if (preview.isPending)
    return (
      <DialogDescription role="status">
        Se verifică punctele taskului…
      </DialogDescription>
    );
  if (preview.isError)
    return (
      <>
        <DialogDescription role="alert" className="text-destructive">
          {
            describeFailure(
              preview.error,
              'Nu am putut verifica punctele taskului.',
            ).message
          }
        </DialogDescription>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => controls.close()}
          >
            Renunță
          </Button>
          <Button type="button" onClick={() => void preview.refetch()}>
            Reîncearcă
          </Button>
        </DialogFooter>
      </>
    );

  const points = raced ?? preview.data;
  const subtasks = preview.data.subtasks;
  const pending = remove.isPending;
  const errorLine = error && (
    <p role="alert" className="m-0 text-sm text-destructive">
      {error}
    </p>
  );

  if (points.members.length === 0)
    return (
      <>
        <DialogDescription>
          {subtasks === 1
            ? 'Se șterge și subtaskul lui. '
            : subtasks > 1
              ? `Se șterg și cele ${countLabel(subtasks, 'subtask', 'subtaskuri')} ale lui. `
              : ''}
          {NO_UNDO}
        </DialogDescription>
        {errorLine}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => controls.close()}
          >
            Renunță
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void run(false)}
          >
            {pending ? 'Se șterge…' : 'Șterge definitiv'}
          </Button>
        </DialogFooter>
      </>
    );

  return (
    <>
      <PointsQuestion points={points} subtasks={subtasks} />
      {errorLine}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => controls.close()}
        >
          Păstrează taskul
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void run(true)}
        >
          {pending ? 'Se șterge…' : 'Șterge taskul și punctele'}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "Taskul a acordat N puncte lui X (…). Ce vrei să faci?" — one Member in the
 * sentence, several as a list under it, each by their name button and points.
 */
function PointsQuestion({
  points,
  subtasks,
}: {
  points: PointsAtStake;
  subtasks: number;
}) {
  const names = useMemberIdentities(
    points.members.map((member) => member.memberId),
  );
  const nameOf = (memberId: string) => {
    const identity = names.data?.get(memberId);
    return (
      <MemberName
        size="sm"
        memberId={memberId}
        nickname={identity?.nickname ?? null}
        fullName={identity?.fullName ?? 'Membru OSUBB'}
        avatarColor={identity?.avatarColor ?? null}
      />
    );
  };
  const one = points.members.length === 1 ? points.members[0] : undefined;
  const source = subtasks > 0 ? 'Taskul și subtaskurile lui au' : 'Taskul a';
  return (
    <>
      <DialogDescription render={<div />} className="grid gap-3">
        {one ? (
          <p className="m-0">
            {source} acordat {formatPointCount(points.total)} lui{' '}
            {nameOf(one.memberId)}. Ce vrei să faci?
          </p>
        ) : (
          <>
            <p className="m-0">
              {source} acordat {formatPointCount(points.total)} acestor{' '}
              {countLabel(points.members.length, 'membru', 'membri')}:
            </p>
            <ul
              aria-label="Membri cu puncte din acest task"
              className="m-0 grid list-none gap-1 rounded-lg border border-border px-3 py-2"
            >
              {points.members.map((member) => (
                <li
                  key={member.memberId}
                  className="flex min-w-0 items-center justify-between gap-3"
                >
                  <span className="min-w-0">{nameOf(member.memberId)}</span>
                  <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
                    {formatPointCount(member.points)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0">Ce vrei să faci?</p>
          </>
        )}
      </DialogDescription>
      <Consequences
        label="Ce se întâmplă dacă îl ștergi"
        items={[
          'Punctele sunt retrase din totaluri și din Clasament.',
          one
            ? 'Membrul primește o notificare.'
            : 'Fiecare membru primește o notificare.',
          `Taskul${subtasks > 0 ? ', cu subtaskurile lui,' : ''} se șterge. ${NO_UNDO}`,
        ]}
      />
    </>
  );
}
