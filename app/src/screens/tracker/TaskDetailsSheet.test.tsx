vi.mock('../../queries/task-umbrella', () => ({
  useCreateSubtask: () => ({ mutateAsync: vi.fn() }),
  useCompleteUmbrella: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./TaskEditControl', () => ({ TaskEditControl: () => null }));
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
const duplicate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 8 }));
vi.mock('../../queries/task-duplication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/task-duplication')>()),
  useDuplicateTask: () => ({ mutateAsync: duplicate }),
}));
const useTaskDetails = vi.hoisted(() => vi.fn());
const candidateHooks = vi.hoisted(() => ({
  candidates: vi.fn(() => ({
    data: [
      {
        id: 31,
        memberId: 'candidate',
        memberName: 'Ana Pop',
        joinedAt: '2026-09-18T08:00:00Z',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })),
  selection: {
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
    isPending: false,
  },
}));
vi.mock('../../queries/task-details', () => ({ useTaskDetails }));
vi.mock('../../queries/task-candidate-selection', () => ({
  usePendingTaskCandidates: candidateHooks.candidates,
  useSelectTaskCandidate: () => candidateHooks.selection,
}));
vi.mock('../../queries/task-queue-control', () => ({
  useSetTaskQueue: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/task-queue', () => ({ useTaskQueue: vi.fn() }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member' } } }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));
vi.mock('./TaskHistory', () => ({
  TaskHistory: () => <p>Istoric autorizat</p>,
}));
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { taskRow } from '../../test/task-fixtures';

describe('Task details sheet', () => {
  it('shows authorized fields, hides unknown Executor identity and closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ review_round: 2, duplicated_from_task_id: 7 }),
        executorName: null,
        subtasks: [],
      },
    });
    const { container } = render(
      <TaskDetailsSheet taskId={1} onClose={onClose} />,
    );
    expect(
      await screen.findByRole('dialog', { name: 'Detalii task' }),
    ).toBeVisible();
    expect(screen.getByText('În cadrul originii')).toBeVisible();
    expect(screen.getByText('Indisponibil')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Duplicat din #7' }),
    ).toBeVisible();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('does not distinguish a hidden Task from a missing Task', async () => {
    useTaskDetails.mockReturnValue({ data: null });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(await screen.findByText('Taskul nu este disponibil.')).toBeVisible();
  });

  it('shows candidate selection only for a Task authorized by the live management query', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow(),
        executorName: 'Executor actual',
        subtasks: [],
      },
    });
    const { rerender } = render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set<number>()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Alege din coadă')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Duplică' }),
    ).not.toBeInTheDocument();

    rerender(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Alege din coadă')).toBeVisible();
    expect(screen.getByRole('radio', { name: /Ana Pop/ })).toBeVisible();
  });
  it('duplicates with a Bucharest deadline, opens the clone and links back to the source', async () => {
    useTaskDetails.mockImplementation((id: number) => ({
      data: {
        task: taskRow({
          id,
          title: id === 8 ? 'Copia nouă' : 'Task sursă',
          duplicated_from_task_id: id === 8 ? 1 : null,
        }),
        executorName: null,
        subtasks: [],
      },
    }));
    const user = userEvent.setup();
    render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1, 8])}
        onClose={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Duplică' }));
    await user.type(
      screen.getByLabelText('Termen nou (ora Bucureștiului)'),
      '2026-10-20T12:30',
    );
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(duplicate).toHaveBeenCalledWith({
      taskId: 1,
      deadline: '2026-10-20T09:30:00.000Z',
    });
    expect(await screen.findByText('Copia nouă')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Duplicat din #1' }));
    expect(await screen.findByText('Task sursă')).toBeVisible();
  });
  it('never offers duplication for an Umbrella even to its manager', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ kind: 'umbrella' }),
        executorName: null,
        subtasks: [],
      },
    });
    render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Subtaskuri vizibile')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Duplică' }),
    ).not.toBeInTheDocument();
  });
});
