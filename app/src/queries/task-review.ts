import {
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { CommandError } from '../lib/command-reasons';
import { parseOrRefuse } from '../lib/form-errors';
import { evaluationSchema } from '../lib/schemas/evaluation';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import { useManagedTasks } from './task-tabs';
import type { TaskPresentationRow } from '../screens/tracker/task-presentation';

/**
 * `can_evaluate_task` for one Task, as the viewer. One key for every reader
 * — the details sheet's Evaluation control and Acasă's De evaluat — so the
 * same Task is asked about once.
 */
function evaluationCapabilityQuery(taskId: number, memberId?: string) {
  return {
    queryKey: ['tasks', 'evaluation-capability', { taskId, memberId }],
    queryFn: memberId
      ? async () => {
          const { data, error } = await supabase.rpc('can_evaluate_task', {
            p_task_id: taskId,
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  } as const;
}

export function useTaskEvaluationCapability(taskId: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery(evaluationCapabilityQuery(taskId, memberId));
}

/** When the latest submission happened, or `Infinity` if none is visible. */
function submittedAt(row: TaskPresentationRow): number {
  const at = row.submission
    ?.filter((item) => item.kind === 'submitted')
    .reduce<number>(
      (latest, item) => Math.max(latest, Date.parse(item.occurred_at)),
      -Infinity,
    );
  return at === undefined || !Number.isFinite(at) ? Infinity : at;
}

/**
 * The managed Tasks that could await the viewer's Evaluation: In review, not
 * executed by the viewer (nobody evaluates their own work), the one submitted
 * longest ago first, then by id so the order never flickers.
 */
export function reviewCandidates<Row extends TaskPresentationRow>(
  rows: readonly Row[],
  memberId: string,
): Row[] {
  return rows
    .filter(
      (row) =>
        row.status === 'in_review' &&
        row.visibleExecutor?.memberId !== memberId &&
        !row.assignments?.some(
          (assignment) =>
            assignment.member_id === memberId && assignment.ended_at === null,
        ),
    )
    .map((row) => ({ row, at: submittedAt(row) }))
    .sort((a, b) => a.at - b.at || a.row.id - b.row.id)
    .map(({ row }) => row);
}

export type AwaitingReview = {
  /** The In-review Task submitted longest ago that the viewer may evaluate. */
  task: TaskPresentationRow | null;
  /** How many In-review Tasks the viewer may evaluate. */
  count: number;
};

/**
 * **De evaluat** on Acasă (#822, ruling R27): the oldest In-review Task
 * awaiting the viewer's Evaluation, and how many there are.
 *
 * Read from De gestionat's own cache (`useManagedTasks`), then narrowed
 * by `can_evaluate_task` per candidate: managing a Task is wider than
 * evaluating it (a Group Responsible manages, but never evaluates, another
 * Responsible's or a Manager's Task — CONTEXT.md). Every candidate is asked,
 * in parallel and under the details sheet's key, so the count is exact; the
 * Task shown is the first in submission order the server says yes to.
 *
 * Without `manageTasks` nothing is read and `data` stays undefined.
 */
export function useAwaitingMyReview(manageTasks: boolean) {
  const memberId = useAuth().session?.user.id;
  const managed = useManagedTasks(manageTasks);
  const candidates = useMemo(
    () =>
      manageTasks && managed.data && memberId
        ? reviewCandidates(managed.data, memberId)
        : [],
    [manageTasks, managed.data, memberId],
  );
  const checks = useQueries({
    queries: candidates.map((task) =>
      evaluationCapabilityQuery(task.id, memberId),
    ),
  });
  const failed = managed.isError
    ? managed
    : checks.find((check) => check.isError);
  const isPending =
    manageTasks &&
    (managed.isPending || checks.some((check) => check.isPending));
  const data: AwaitingReview | undefined =
    !manageTasks || isPending || failed
      ? undefined
      : {
          task:
            candidates.find((_, index) => checks[index]?.data === true) ?? null,
          count: checks.filter((check) => check.data === true).length,
        };
  return {
    data,
    isPending: !failed && isPending,
    isError: Boolean(failed),
    error: failed?.error ?? null,
    refetch: () => {
      if (managed.isError) void managed.refetch();
      for (const check of checks) if (check.isError) void check.refetch();
    },
  };
}

export type EvaluationInput = {
  taskId: number;
  difficulty: number;
  rating: number;
  note: string;
};
/** Per-action copy for the two refusals that name what was being attempted. */
export type ReviewErrorCopy = { forbidden: string; failed: string };
const evaluationCopy: ReviewErrorCopy = {
  forbidden: 'Nu mai ai permisiunea de a evalua acest task.',
  failed: 'Nu am putut salva evaluarea. Încearcă din nou.',
};
/**
 * A refused review command. A reason we know keeps its shared copy (and the
 * form can show it under its field); anything else is told by its code.
 */
export function reviewError(
  error: { code?: string; message?: string },
  copy = evaluationCopy,
) {
  const { code } = error;
  return new CommandError(
    error,
    code === 'PT409'
      ? 'Taskul s-a schimbat. Verifică starea actuală înainte de a încerca din nou.'
      : code === '42501'
        ? copy.forbidden
        : code === 'PT404'
          ? 'Taskul nu mai este disponibil.'
          : copy.failed,
  );
}
export async function evaluateTask(
  input: EvaluationInput & { outcome?: 'completed' | 'unfulfilled' },
) {
  const values = parseOrRefuse(evaluationSchema, input, evaluationCopy.failed);
  const { data, error } = await supabase.rpc(
    input.outcome === 'unfulfilled'
      ? 'mark_task_unfulfilled'
      : 'complete_task_review',
    {
      p_task_id: input.taskId,
      p_difficulty: values.difficulty,
      p_rating: values.rating,
      p_note: values.note,
    },
  );
  if (error) throw reviewError(error);
  return data;
}
export function useEvaluateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: evaluateTask,
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]);
    },
  });
}
