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
const taskHistory = vi.hoisted(() =>
  vi.fn((): { data?: unknown[]; isError?: boolean; refetch?: () => void } => ({
    data: [],
  })),
);
vi.mock('../../queries/task-history', () => ({ useTaskHistory: taskHistory }));
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
    // A direct Task is local only (R26): no Audiență row.
    expect(screen.queryByText('Audiență')).toBeNull();
    expect(screen.queryByText('În cadrul originii')).toBeNull();
    // No second Executor row and no "Indisponibil" (B20, Audit D-2).
    expect(screen.queryByText('Indisponibil')).toBeNull();
    expect(screen.queryByText('Executor')).toBeNull();
    // Before an Evaluation there is no Dificultate or Nota to show.
    expect(screen.queryByText('Dificultate')).toBeNull();
    expect(screen.queryByText('Nota')).toBeNull();
    expect(screen.queryByText('Neevaluat')).toBeNull();
    // The review round is a reviewer's fact: not for this non-manager.
    expect(screen.queryByText('Rundă de verificare')).toBeNull();
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
  it('shows the Audiență row on a public Task (R26)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ assignment_mode: 'public', audience: 'org' }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    const row = screen.getByText('Audiență').closest('div') as HTMLElement;
    expect(within(row).getByText('Toți membrii OSUBB')).toBeVisible();
    // Once: the card copy in the sheet drops its OSUBB chip (B20).
    expect(screen.queryByText('OSUBB')).toBeNull();
  });
  it('shows the review round only to a manager, and only from round 1 (B20)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ review_round: 0 }),
        executorName: null,
        subtasks: [],
      },
    });
    const { unmount } = render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('dialog', { name: 'Detalii task' });
    expect(screen.queryByText('Rundă de verificare')).toBeNull();
    unmount();

    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ review_round: 2 }),
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
    const row = (await screen.findByText('Rundă de verificare')).closest(
      'div',
    ) as HTMLElement;
    expect(within(row).getByText('2')).toBeVisible();
  });
  it('shows Dificultate and Nota once, on the card, after an Evaluation', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'completed',
          assignments: [],
          visibleExecutor: null,
          evaluations: [
            { id: 1, difficulty: 3, rating: 4, points: 9, reversed_at: null },
          ],
        }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    expect(
      screen.getAllByRole('img', { name: 'Dificultate 3 din 5' }),
    ).toHaveLength(1);
    expect(screen.getByText(/9 puncte/)).toHaveTextContent('Nota 4');
    // A finished Task never reads "Neatribuit" (Audit D-1).
    expect(screen.queryByText('Neatribuit')).toBeNull();
  });
  it('names the Executor who finished an evaluated Task (Audit D-1, #861)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'completed',
          assignments: [],
          visibleExecutor: {
            memberId: 'ioana',
            fullName: 'Ioana Pop',
            nickname: null,
            isCurrent: false,
          },
          evaluations: [
            { id: 1, difficulty: 3, rating: 4, points: 9, reversed_at: null },
          ],
        }),
        executorName: 'Ioana Pop',
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    const executor = screen.getByText('Executor:').closest('p') as HTMLElement;
    expect(
      within(executor).getByRole('button', {
        name: 'Profilul membrului Ioana Pop',
      }),
    ).toBeVisible();
    expect(screen.queryByText('Neatribuit')).toBeNull();
    expect(screen.queryByText('Indisponibil')).toBeNull();
  });
  it('names no Executor on the viewer’s own finished Task (B2, #861)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'unfulfilled',
          assignments: [],
          visibleExecutor: {
            memberId: 'member',
            fullName: 'Membrul Curent',
            nickname: null,
            isCurrent: false,
          },
        }),
        executorName: 'Membrul Curent',
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Detalii task' });
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Neatribuit')).toBeNull();
  });
  it('names the Executor as a button that opens their Member Card', async () => {
    const user = userEvent.setup();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          assignments: [{ id: 1, member_id: 'ioana', ended_at: null }],
          visibleExecutor: {
            memberId: 'ioana',
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
    // One Executor line: the card's (B20).
    expect(screen.getAllByText(/^Executor/)).toHaveLength(1);
    const executor = screen.getByText('Executor:').closest('p') as HTMLElement;
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
        task: taskRow({ assignment_mode: 'public' }),
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

  it.each(['todo', 'in_progress'] as const)(
    'shows no queue section at all on a direct Task (%s, F-2)',
    async (status) => {
      useTaskDetails.mockReturnValue({
        data: {
          task: taskRow({ status, assignment_mode: 'direct' }),
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
      expect(screen.queryByText(/persoană înscrisă în coadă/)).toBeNull();
      expect(screen.queryByText(/Nu există persoane în coadă/)).toBeNull();
    },
  );

  it('keeps the queue section on a public Task in progress', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'in_progress', assignment_mode: 'public' }),
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
      screen.getByLabelText('Termen nou (ora României)'),
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
  it('steps back through Umbrella and Subtask to the Task first opened (D20)', async () => {
    const titles: Record<number, string> = {
      1: 'Subtask deschis',
      2: 'Umbrela festivalului',
      3: 'Alt subtask',
    };
    useTaskDetails.mockImplementation((id: number) => ({
      data: {
        task:
          id === 2
            ? taskRow({
                id,
                title: titles[id],
                kind: 'umbrella',
                assignments: [],
              })
            : taskRow({
                id,
                title: titles[id],
                parent_task_id: 2,
                parent: { title: titles[2] as string },
              }),
        executorName: null,
        subtasks:
          id === 2
            ? [taskRow({ id: 3, title: titles[3], parent_task_id: 2 })]
            : [],
      },
    }));
    const user = userEvent.setup();
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(await screen.findByText('Subtask deschis')).toBeVisible();
    // On the Task first opened there is nowhere to go back to.
    expect(screen.queryByRole('button', { name: /Înapoi la/ })).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Deschide taskul-umbrelă' }),
    );
    expect(await screen.findByText('Umbrela festivalului')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Alt subtask' }));
    expect(
      await screen.findByText('Alt subtask', { selector: 'h2' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Înapoi la #2' }));
    expect(await screen.findByText('Umbrela festivalului')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Înapoi la #1' }));
    expect(await screen.findByText('Subtask deschis')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Înapoi la/ })).toBeNull();
    // Focus returns to the sheet title, so the reader starts at the top.
    expect(screen.getByRole('heading', { name: 'Detalii task' })).toHaveFocus();
  });
  it('states no Atribuire for an Umbrella, which has no Assignment (F-28)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ kind: 'umbrella', assignment_mode: null }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(await screen.findByText('Subtaskuri vizibile')).toBeVisible();
    expect(screen.queryByText('Atribuire')).toBeNull();
    expect(screen.queryByText('Indisponibilă')).toBeNull();
  });

  it('shows the Executor the note of the latest return for changes (F-23)', async () => {
    taskHistory.mockReturnValue({
      data: [
        {
          id: 1,
          kind: 'returned_to_progress',
          note: 'Prima rundă.',
          occurred_at: '2026-09-14T10:00:00Z',
        },
        {
          id: 2,
          kind: 'submitted',
          note: 'Gata.',
          occurred_at: '2026-09-15T10:00:00Z',
        },
        {
          id: 3,
          kind: 'returned_to_progress',
          note: 'Adaugă sursele.',
          occurred_at: '2026-09-16T10:00:00Z',
        },
      ],
    });
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'in_progress',
          review_round: 2,
          visibleExecutor: { memberId: 'member', fullName: 'Eu' },
        }),
        executorName: null,
        subtasks: [],
      },
    });
    try {
      render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
      const note = await screen.findByRole('region', {
        name: 'Modificări cerute',
      });
      expect(within(note).getByText('Adaugă sursele.')).toBeVisible();
      expect(screen.queryByText('Prima rundă.')).toBeNull();
    } finally {
      taskHistory.mockReturnValue({ data: [] });
    }
  });

  it('says so, with a retry, when the return note cannot be read', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    taskHistory.mockReturnValue({ isError: true, refetch });
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'in_progress',
          review_round: 1,
          visibleExecutor: { memberId: 'member', fullName: 'Eu' },
        }),
        executorName: null,
        subtasks: [],
      },
    });
    try {
      render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
      expect(
        await screen.findByText('Nu am putut încărca modificările cerute.'),
      ).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'Reîncarcă modificările cerute' }),
      );
      expect(refetch).toHaveBeenCalledOnce();
    } finally {
      taskHistory.mockReturnValue({ data: [] });
    }
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
