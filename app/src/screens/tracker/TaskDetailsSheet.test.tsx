vi.mock('../../queries/task-umbrella', () => ({
  useCreateTask: () => ({ mutateAsync: vi.fn() }),
  useCompleteUmbrella: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./TaskEditControl', () => ({ TaskEditControl: () => null }));
import { render, screen, within } from '@testing-library/react';
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
vi.mock('../../queries/task-review', () => ({
  useTaskEvaluationCapability: () => ({ data: false }),
}));
vi.mock('../../queries/task-details', () => ({ useTaskDetails }));
vi.mock('../../queries/task-cancel', () => ({
  useCancelTask: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/task-candidate-selection', () => ({
  usePendingTaskCandidates: candidateHooks.candidates,
  useSelectTaskCandidate: () => candidateHooks.selection,
}));
vi.mock('../../queries/task-assignment', () => ({
  useTaskAssignment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/task-queue-control', () => ({
  useSetTaskQueue: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/task-queue', () => ({
  useTaskQueue: vi.fn(() => ({ isPending: false, data: [] })),
}));
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
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

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
  it('names the Executor as a button that opens their Member Card', async () => {
    const user = userEvent.setup();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          visibleExecutor: {
            memberId: 'member',
            fullName: 'Ioana Pop',
            nickname: null,
          },
        }),
        executorName: 'Ioana Pop',
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    const executor = screen.getByText('Executor').closest('div') as HTMLElement;
    await user.click(
      within(executor).getByRole('button', {
        name: 'Profilul membrului Ioana Pop',
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Ioana Pop' }),
    ).toBeVisible();
  });
  it('does not distinguish a hidden Task from a missing Task', async () => {
    useTaskDetails.mockReturnValue({ data: null });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(await screen.findByText('Taskul nu este disponibil.')).toBeVisible();
  });
  it('confirms a just-created Task above its details', async () => {
    useTaskDetails.mockReturnValue({
      data: { task: taskRow(), executorName: null, subtasks: [] },
    });
    render(
      <TaskDetailsSheet
        taskId={1}
        notice="Taskul a fost creat."
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByText('Taskul a fost creat.', { selector: 'p' }),
    ).toHaveAttribute('role', 'status');
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

  it('hides the Candidate selector on an in_review Task, where the server refuses selection (#646)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'in_review', assignment_mode: 'public' }),
        executorName: 'Executor actual',
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
    expect(await screen.findByText('Coada taskului')).toBeVisible();
    expect(screen.queryByText('Alege din coadă')).not.toBeInTheDocument();
  });

  it('shows no empty queue section on a direct Task in review (#646)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'in_review' }),
        executorName: 'Executor actual',
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
    await screen.findByText('Istoricul taskului');
    expect(screen.queryByText('Coada taskului')).not.toBeInTheDocument();
  });

  it.each(['completed', 'unfulfilled', 'cancelled'] as const)(
    'hides the Candidate selector on a terminal Task (%s)',
    async (status) => {
      useTaskDetails.mockReturnValue({
        data: {
          task: taskRow({ status }),
          executorName: 'Executor actual',
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
      await screen.findByRole('dialog', { name: 'Detalii task' });
      expect(screen.queryByText('Coada taskului')).not.toBeInTheDocument();
      expect(screen.queryByText('Alege din coadă')).not.toBeInTheDocument();
    },
  );
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
      '2030-10-20T12:30',
    );
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(duplicate).toHaveBeenCalledWith({
      taskId: 1,
      deadline: '2030-10-20T09:30:00.000Z',
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

  it('shows the latest Submission Note with its link whenever one exists', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'in_progress',
          review_round: 1,
          submission: [
            {
              id: 12,
              kind: 'submitted',
              note: 'Am pus prezentarea în folder.',
              details: {
                link_label: 'Prezentare',
                link_url: 'https://drive.example/prezentare',
              },
              occurred_at: '2026-09-15T09:30:00Z',
            },
          ],
        }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    // Once, on the sheet itself: the card copy inside it does not repeat it.
    const notes = screen.getAllByRole('region', { name: 'Notă la trimitere' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Am pus prezentarea în folder.');
    expect(notes[0]).toHaveTextContent('15 septembrie 2026, 12:30');
    expect(
      within(notes[0] as HTMLElement).getByRole('link', {
        name: 'Prezentare (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('target', '_blank');
    // The sheet's card is not the deep-link anchor.
    expect(document.getElementById('task-1')).toBeNull();
  });
  it('shows no Submission Note for a Task never submitted', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ submission: [] }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
  });
});
