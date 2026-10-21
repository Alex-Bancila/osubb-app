vi.mock('../../queries/task-umbrella', () => ({
  useCreateTask: () => ({ mutateAsync: vi.fn() }),
  useCreateTasks: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteUmbrella: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./TaskEditControl', () => ({ TaskEditControl: () => null }));
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));
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
const review = vi.hoisted(() => ({ canEvaluate: false }));
vi.mock('../../queries/task-review', () => ({
  useTaskEvaluationCapability: () => ({ data: review.canEvaluate }),
  useEvaluateTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../components/tasks/EvaluationFields', () => ({
  EvaluationFields: ({ outcome }: { outcome: string }) => (
    <p>Formular de evaluare: {outcome}</p>
  ),
}));
vi.mock('../../queries/task-details', () => ({ useTaskDetails }));
// #1053: `can_manage_task` for the one shown Task; unanswered unless a test
// says so.
const manageCapability = vi.hoisted(() =>
  vi.fn(
    (_taskId: number | null, _enabled?: boolean): { data?: boolean } => ({}),
  ),
);
vi.mock('../../queries/task-lists', () => ({
  useTaskManageCapability: manageCapability,
}));
const deleteTask = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ deletedTasks: 1, pointsReversed: 0, members: 0 }),
);
vi.mock('../../queries/delete-for-good', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/delete-for-good')>()),
  useTaskDeletePreview: () => ({
    isPending: false,
    isError: false,
    data: { subtasks: 0, total: 0, members: [] },
  }),
  useDeleteTask: () => ({ mutateAsync: deleteTask, isPending: false }),
}));
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
import { pickDate } from '../../test/date-picker';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import { TaskDetailsSheet } from './TaskDetailsSheet';
// A deadline next month: always in the future, and one page away in the
// date picker.
const nextMonth = new Date();
nextMonth.setUTCDate(1);
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
const DEADLINE = `${nextMonth.toISOString().slice(0, 7)}-15T12:30`;
import { taskRow } from '../../test/task-fixtures';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

/** The fixture Task's title, which names the sheet. */
const TITLE = 'Pregătește materialele';

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
    // The sheet is titled by the Task, its Group and status under the title.
    const sheet = await screen.findByRole('dialog', { name: TITLE });
    expect(sheet).toBeVisible();
    expect(screen.queryByText('Detalii task')).toBeNull();
    const header = sheet.querySelector('[data-slot="sheet-header"]');
    expect(
      within(header as HTMLElement).getByRole('heading', { name: TITLE }),
    ).toBeVisible();
    const chips = within(
      header?.querySelector('[data-slot="task-sheet-chips"]') as HTMLElement,
    );
    expect(chips.getByText('Departament · Educațional')).toBeVisible();
    expect(chips.getByText('De făcut')).toBeVisible();
    // No card inside the sheet: the Task is not shown a second time in a
    // border of its own, and the facts are plain label/value rows.
    expect(sheet.querySelector('[data-slot="card"]')).toBeNull();
    expect(within(sheet).queryByRole('article')).toBeNull();
    expect(screen.getAllByText(TITLE)).toHaveLength(1);
    const facts = sheet.querySelector('[data-slot="task-facts"]');
    const deadline = within(facts as HTMLElement)
      .getByText('Termen')
      .closest('div') as HTMLElement;
    expect(deadline.querySelector('dt svg')).not.toBeNull();
    expect(
      within(deadline).getByText(/16 sept\.( 2026)? · 13:00/),
    ).toBeVisible();
    expect(
      within(facts as HTMLElement)
        .getByText('Atribuire')
        .closest('div'),
    ).toHaveTextContent('AtribuireDirectă');
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
  it('opening a Task reads the member’s Notifications about it, only once it loads (#1012)', async () => {
    useTaskDetails.mockReturnValue({ isPending: true });
    const view = render(<TaskDetailsSheet taskId={7} onClose={vi.fn()} />);
    expect(readNotificationsAbout).toHaveBeenLastCalledWith([]);
    useTaskDetails.mockReturnValue({
      data: { task: taskRow(), executorName: null, subtasks: [] },
    });
    view.rerender(<TaskDetailsSheet taskId={7} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: TITLE });
    expect(readNotificationsAbout).toHaveBeenLastCalledWith(['task:7']);
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
    await screen.findByRole('dialog', { name: TITLE });
    const row = screen.getByText('Audiență').closest('div') as HTMLElement;
    expect(within(row).getByText('Toți membrii OSUBB')).toBeVisible();
    // Once: the sheet has no OSUBB chip beside the row (B20).
    expect(screen.queryByText('OSUBB')).toBeNull();
  });
  it('shows Cine îl vede on a public Task above Recrut, and not at Recrut (R57)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          assignment_mode: 'public',
          audience: 'org',
          min_level: 2,
        }),
        executorName: null,
        subtasks: [],
      },
    });
    const view = render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: TITLE });
    const row = screen.getByText('Cine îl vede').closest('div') as HTMLElement;
    expect(within(row).getByText('De la Voluntar Activ')).toBeVisible();
    view.unmount();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          assignment_mode: 'public',
          audience: 'org',
          min_level: 0,
        }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: TITLE });
    expect(screen.queryByText('Cine îl vede')).toBeNull();
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
    await screen.findByRole('dialog', { name: TITLE });
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
  it('shows Dificultate and Nota once, on the Evaluare row, after an Evaluation', async () => {
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
    await screen.findByRole('dialog', { name: TITLE });
    expect(
      screen.getAllByRole('img', { name: 'Dificultate 3 din 5' }),
    ).toHaveLength(1);
    const evaluation = screen.getByText('Evaluare').closest('div');
    expect(evaluation).toHaveTextContent(/9 puncte\s*Nota 4/);
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
    await screen.findByRole('dialog', { name: TITLE });
    const executor = screen.getByText('Executor').closest('div') as HTMLElement;
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
    await screen.findByRole('dialog', { name: TITLE });
    expect(screen.queryByText('Executor')).toBeNull();
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
    await screen.findByRole('dialog', { name: TITLE });
    // One Executor row (B20).
    expect(screen.getAllByText(/^Executor/)).toHaveLength(1);
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

  it('asks the server about a Task it does not know to be managed, when the opener says to (#1053)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'completed', assignments: [] }),
        executorName: null,
        subtasks: [],
      },
    });
    manageCapability.mockReturnValue({ data: undefined });
    const { rerender } = render(
      <TaskDetailsSheet taskId={1} askManage onClose={vi.fn()} />,
    );
    expect(manageCapability).toHaveBeenLastCalledWith(1, true);
    // No answer yet: no manager control.
    expect(
      screen.queryByRole('button', { name: 'Duplică' }),
    ).not.toBeInTheDocument();
    manageCapability.mockReturnValue({ data: true });
    rerender(<TaskDetailsSheet taskId={1} askManage onClose={vi.fn()} />);
    expect(
      await screen.findByRole('button', { name: 'Duplică' }),
    ).toBeVisible();
  });

  it('asks nothing about a Task the opener knows to be managed, or when it was not told to ask', async () => {
    useTaskDetails.mockReturnValue({
      data: { task: taskRow(), executorName: null, subtasks: [] },
    });
    manageCapability.mockReturnValue({ data: undefined });
    const { rerender } = render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        askManage
        onClose={vi.fn()}
      />,
    );
    expect(manageCapability).toHaveBeenLastCalledWith(1, false);
    expect(
      await screen.findByRole('button', { name: 'Duplică' }),
    ).toBeVisible();
    // Cereri opens the sheet to read a Task: nothing is asked there.
    rerender(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(manageCapability).toHaveBeenLastCalledWith(1, false);
    expect(
      screen.queryByRole('button', { name: 'Duplică' }),
    ).not.toBeInTheDocument();
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
      await screen.findByRole('dialog', { name: TITLE });
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
    await pickDate(
      user,
      screen.getByLabelText('Termen nou — ora României'),
      DEADLINE,
    );
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(duplicate).toHaveBeenCalledWith({
      taskId: 1,
      deadline: bucharestWallTimeToIso(DEADLINE),
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
    expect(
      screen.getByRole('heading', { name: 'Subtask deschis' }),
    ).toHaveFocus();
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

  it('reads the description as Formatted Text, and the Submission Note as the text typed (R60, R7)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          status: 'in_progress',
          review_round: 1,
          description: 'Tipărește **40** de exemplare.\nLa Copy Center.',
          submission: [
            {
              id: 12,
              kind: 'submitted',
              note: 'Am pus **prezentarea** în folder.',
              details: {},
              occurred_at: '2026-09-15T09:30:00Z',
            },
          ],
        }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    const sheet = await screen.findByRole('dialog', { name: TITLE });
    const description = sheet.querySelector('[data-slot="task-description"]');
    expect(description).not.toBeNull();
    expect(
      within(description as HTMLElement).getByText('40', {
        selector: 'strong',
      }),
    ).toBeVisible();
    expect(description?.querySelector('br')).not.toBeNull();
    expect(description?.className ?? '').not.toMatch(/whitespace-pre/);
    expect(description?.querySelector('.whitespace-pre-wrap')).toBeNull();
    // The Submission Note is plain by ruling R7: its stars stay.
    const note = within(sheet).getByRole('region', {
      name: 'Notă la trimitere',
    });
    expect(note).toHaveTextContent('Am pus **prezentarea** în folder.');
    expect(note.querySelector('strong')).toBeNull();
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
    await screen.findByRole('dialog', { name: TITLE });
    // Once, on the sheet itself: the card copy inside it does not repeat it.
    const notes = screen.getAllByRole('region', { name: 'Notă la trimitere' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Am pus prezentarea în folder.');
    expect(notes[0]).toHaveTextContent(/15 sept\.( 2026)? · 12:30/);
    expect(
      within(notes[0] as HTMLElement).getByRole('link', {
        // R46: a details view says what the button does.
        name: 'Deschide: Prezentare (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('target', '_blank');
    // The sheet is not the deep-link anchor.
    expect(document.getElementById('task-1')).toBeNull();
  });
  it('shows the Task’s Attached Links as "Deschide: <etichetă>" (R46)', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({
          links: [
            { label: 'Brief', url: 'https://drive.example/brief' },
            { label: 'Afiș', url: 'https://drive.example/afis' },
          ],
        }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: TITLE });
    const list = screen.getByRole('list', { name: 'Linkuri atașate' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Deschide: Brief', 'Deschide: Afiș']);
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
    await screen.findByRole('dialog', { name: TITLE });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
  });

  /* #1017: Șterge definitiv, for the Task's managers in every status. */
  it('offers Șterge definitiv to a manager, finished Tasks included, and closes on delete', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'completed' }),
        executorName: null,
        subtasks: [],
      },
    });
    const { rerender } = render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set<number>()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    await screen.findByRole('dialog', { name: TITLE });
    expect(
      screen.queryByRole('button', { name: 'Șterge definitiv' }),
    ).toBeNull();
    // Nothing to put behind it: no "⋯" for a Member who manages nothing.
    expect(
      screen.queryByRole('button', { name: 'Mai multe acțiuni' }),
    ).toBeNull();

    rerender(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    // A completed Task has no Anulează, but may still be deleted.
    expect(
      screen.queryByRole('button', { name: 'Anulează taskul' }),
    ).toBeNull();
    // Behind the "⋯" menu, not a button in the row; destructive, last.
    const actions = document.querySelector('[data-slot="task-actions"]');
    expect(
      within(actions as HTMLElement).queryByRole('button', {
        name: 'Șterge definitiv',
      }),
    ).toBeNull();
    const more = within(actions as HTMLElement).getByRole('button', {
      name: 'Mai multe acțiuni',
    });
    await user.click(more);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Șterge definitiv']);
    await user.click(items[0] as HTMLElement);
    const confirm = await screen.findByRole('dialog', {
      name: 'Ștergi definitiv taskul?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Șterge definitiv' }),
    );
    expect(deleteTask).toHaveBeenCalledWith({ taskId: 1, withPoints: false });
    await vi.waitFor(() =>
      expect(onDeleted).toHaveBeenCalledWith('Taskul a fost șters definitiv.'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  /* The commands have a hierarchy: steps as buttons, Duplică as an icon
     button, and the rest behind one "⋯" menu, destructive last. */
  it('keeps Duplică as an icon button and puts Anulează and Șterge definitiv behind the "⋯" menu', async () => {
    const user = userEvent.setup();
    useTaskDetails.mockReturnValue({
      data: { task: taskRow(), executorName: null, subtasks: [] },
    });
    render(
      <TaskDetailsSheet
        taskId={1}
        managedTaskIds={new Set([1])}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('dialog', { name: TITLE });
    const actions = within(
      document.querySelector('[data-slot="task-actions"]') as HTMLElement,
    );
    const copy = actions.getByRole('button', { name: 'Duplică' });
    expect(copy.querySelector('svg')).not.toBeNull();
    expect(within(copy).getByText('Duplică')).toHaveClass('sr-only');
    // Neither is a button in the row any more.
    expect(
      actions.queryByRole('button', { name: 'Anulează taskul' }),
    ).toBeNull();
    expect(
      actions.queryByRole('button', { name: 'Șterge definitiv' }),
    ).toBeNull();
    const more = actions.getByRole('button', { name: 'Mai multe acțiuni' });
    await user.click(more);
    expect(
      (await screen.findAllByRole('menuitem')).map((item) => item.textContent),
    ).toEqual(['Anulează taskul', 'Șterge definitiv']);

    // The item opens the same pop-up, with its required reason…
    await user.click(screen.getByRole('menuitem', { name: 'Anulează taskul' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Anulează taskul',
    });
    expect(within(dialog).getByLabelText('Motiv')).toBeVisible();
    // …and closing it hands focus back to the menu's button.
    await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Anulează taskul' }),
      ).toBeNull(),
    );
    await vi.waitFor(() => expect(more).toHaveFocus());
  });

  it('offers Marchează nerealizat in the menu, under the control’s own rule, and opens its form', async () => {
    const user = userEvent.setup();
    const overdue = {
      task: taskRow({
        status: 'in_progress',
        deadline: '2020-01-01T10:00:00Z',
        assignments: [{ id: 1, member_id: 'ioana', ended_at: null }],
        visibleExecutor: { memberId: 'ioana', fullName: 'Ioana Pop' },
      }),
      executorName: 'Ioana Pop',
      subtasks: [],
    };
    useTaskDetails.mockReturnValue({ data: overdue });
    review.canEvaluate = true;
    try {
      const view = render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
      await screen.findByRole('dialog', { name: TITLE });
      // Not a button in the row: the menu's one item for this evaluator.
      expect(
        screen.queryByRole('button', { name: 'Marchează nerealizat' }),
      ).toBeNull();
      await user.click(
        screen.getByRole('button', { name: 'Mai multe acțiuni' }),
      );
      const items = await screen.findAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'Marchează nerealizat',
      ]);
      await user.click(items[0] as HTMLElement);
      expect(
        await screen.findByText('Formular de evaluare: unfulfilled'),
      ).toBeVisible();
      view.unmount();

      // Not overdue: nothing to mark, so no item — and here no menu at all.
      useTaskDetails.mockReturnValue({
        data: {
          ...overdue,
          task: { ...overdue.task, deadline: '2999-01-01T10:00:00Z' },
        },
      });
      render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
      await screen.findByRole('dialog', { name: TITLE });
      expect(
        screen.queryByRole('button', { name: 'Mai multe acțiuni' }),
      ).toBeNull();
    } finally {
      review.canEvaluate = false;
    }
  });

  it('keeps the Executor’s own steps in the sheet, without a card around them', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ status: 'in_progress' }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    const sheet = await screen.findByRole('dialog', { name: TITLE });
    expect(
      within(sheet).getByRole('button', { name: 'Trimite la verificare' }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole('button', { name: 'Renunță la task' }),
    ).toBeVisible();
    expect(sheet.querySelector('[data-slot="card-footer"]')).toBeNull();
  });

  it('shows the description and the history as a disclosure with its icon', async () => {
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ description: 'Tipărește 40 de exemplare.' }),
        executorName: null,
        subtasks: [],
      },
    });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    const sheet = await screen.findByRole('dialog', { name: TITLE });
    expect(within(sheet).getByText('Tipărește 40 de exemplare.')).toBeVisible();
    // The shared disclosure: a row whose chevron turns, with the icon.
    const history = within(sheet).getByText('Istoricul taskului');
    expect(history.closest('summary')).not.toBeNull();
    expect(history.closest('details')).toHaveAttribute(
      'data-slot',
      'disclosure',
    );
    expect(history.querySelector('svg')).not.toBeNull();
  });
});
