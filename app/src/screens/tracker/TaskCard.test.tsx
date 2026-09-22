import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));
vi.mock('./TaskQueueStatus', () => ({
  TaskQueueStatus: () => <p>Stare înscriere</p>,
}));
vi.mock('./TaskInterestControls', () => ({
  TaskInterestControls: () => <button>Participă</button>,
}));
import { taskRow } from '../../test/task-fixtures';

function card(
  overrides: Partial<TaskPresentationRow> = {},
  onProgress = vi.fn().mockResolvedValue(undefined),
  memberId = 'member',
) {
  const task = toTaskPresentation(
    taskRow(overrides),
    new Date('2026-09-15T12:00:00Z'),
  );
  return {
    ...render(
      <TaskCard
        task={task}
        memberId={memberId}
        pending={false}
        onProgress={onProgress}
      />,
    ),
    onProgress,
  };
}

describe('Member Task cards', () => {
  it.each([
    { status: 'todo' as const, queue_closed_at: '2026-09-15T10:00:00Z' },
    { status: 'completed' as const, queue_closed_at: null },
  ])(
    'keeps participation visible without actions for closed/terminal work',
    (overrides) => {
      const task = toTaskPresentation(
        taskRow({ ...overrides, assignment_mode: 'public' }),
        new Date('2026-09-15'),
      );
      render(
        <TaskCard
          task={task}
          allowInterest
          memberId="member"
          pending={false}
          onProgress={vi.fn()}
        />,
      );
      expect(screen.getByText('Stare înscriere')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Participă' }),
      ).not.toBeInTheDocument();
    },
  );
  it('shows a named Origin, Bucharest deadline and the current stage', () => {
    card();
    expect(
      screen.getByRole('article', { name: 'Pregătește materialele' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Departament · Educațional')).toBeInTheDocument();
    expect(screen.getByText(/16 septembrie 2026, 13:00/)).toHaveAttribute(
      'dateTime',
      '2026-09-16T10:00:00Z',
    );
    expect(
      screen.getByText('Taskul este atribuit și așteaptă să fie început.'),
    ).toBeInTheDocument();
  });

  it('shows the active Executor name on an ordinary Task', () => {
    card({
      visibleExecutor: { memberId: 'member', fullName: 'Ioana Executor' },
    });

    expect(screen.getByText('Responsabil:')).toBeInTheDocument();
    expect(screen.getByText('Ioana Executor')).toBeInTheDocument();
  });

  it('distinguishes an unassigned Task from an unavailable Executor name', () => {
    const { unmount } = card({ assignments: [], visibleExecutor: null });
    expect(screen.getByText('Neatribuit')).toBeInTheDocument();
    unmount();

    card({
      visibleExecutor: { memberId: 'member', fullName: null },
    });
    expect(screen.getByText('Nume indisponibil')).toBeInTheDocument();
  });

  it('does not show an Executor row for an Umbrella Task', () => {
    card({
      kind: 'umbrella',
      assignments: [],
      visibleExecutor: { memberId: 'member', fullName: 'Nume imposibil' },
    });

    expect(screen.queryByText('Responsabil:')).not.toBeInTheDocument();
    expect(screen.queryByText('Nume imposibil')).not.toBeInTheDocument();
  });

  it('shows the Umbrella, Campaign and independent feedback/overdue markers', () => {
    card({
      status: 'in_progress',
      review_round: 1,
      deadline: '2026-09-14T10:00:00Z',
      parent_task_id: 2,
      parent: { title: 'Recrutare' },
      campaign_id: 3,
      campaign: { name: 'Toamnă' },
    });
    expect(screen.getByText('Subtask din: Recrutare')).toBeInTheDocument();
    expect(screen.getByText('Campanie: Toamnă')).toBeInTheDocument();
    expect(screen.getByText('Modificări cerute')).toBeInTheDocument();
    expect(screen.getByText('Termen depășit')).toBeInTheDocument();
  });

  it.each(['unfulfilled', 'completed'] as const)(
    'distinguishes %s and retains zero evaluation points',
    (status) => {
      card({
        status,
        completed_at: '2026-09-17T00:00:00Z',
        evaluations: [
          { id: 1, difficulty: 3, rating: 2, points: 0, reversed_at: null },
        ],
      });
      expect(
        screen.getByText(
          status === 'completed' ? 'Finalizat cu întârziere' : 'Nerealizat',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('0 puncte · Dificultate 3 · Nota 2'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Termen depășit')).not.toBeInTheDocument();
    },
  );

  it('preserves long content and handles missing optional relations', () => {
    const title = 'Titlu'.repeat(100);
    const description = 'Descriere '.repeat(100);
    card({
      title,
      description,
      deadline: null,
      group: null,
      parent_task_id: 2,
      parent: null,
    });
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(description.trim())).toBeInTheDocument();
    expect(screen.getByText('Fără termen')).toBeInTheDocument();
    expect(screen.getByText('Origine indisponibilă')).toBeInTheDocument();
    expect(screen.getByText('Subtask din: Task-umbrelă')).toBeInTheDocument();
    expect(screen.queryByText(/puncte/)).not.toBeInTheDocument();
  });

  it('offers keyboard-operable start only to the current Executor', async () => {
    const user = userEvent.setup();
    const { onProgress } = card();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Începe taskul' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onProgress).toHaveBeenCalledWith(1, 'start');
  });

  it('offers submission for work in progress', async () => {
    const user = userEvent.setup();
    const { onProgress } = card({ status: 'in_progress' });
    await user.click(
      screen.getByRole('button', { name: 'Trimite la verificare' }),
    );
    expect(onProgress).toHaveBeenCalledWith(1, 'submit');
  });

  it('offers give-up only to the active Executor before review', () => {
    const { unmount } = card({ status: 'in_progress' });
    expect(
      screen.getByRole('button', { name: 'Renunță la task' }),
    ).toBeVisible();
    unmount();

    card({ status: 'in_review' });
    expect(
      screen.queryByRole('button', { name: 'Renunță la task' }),
    ).not.toBeInTheDocument();
  });

  it('withholds actions from a former Executor', () => {
    card({}, vi.fn(), 'former');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('prevents duplicate submissions and preserves current state on failure', async () => {
    const user = userEvent.setup();
    let reject: (error: Error) => void = () => {};
    const onProgress = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    card({}, onProgress);
    await user.click(screen.getByRole('button', { name: 'Începe taskul' }));
    expect(screen.getByRole('button', { name: 'Se salvează…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Se salvează…' }));
    expect(onProgress).toHaveBeenCalledOnce();
    reject(new Error('Taskul s-a schimbat.'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Taskul s-a schimbat.',
    );
    expect(screen.getByText('De făcut')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Începe taskul' })).toBeEnabled();
  });

  it('passes automated accessibility checks', async () => {
    const { container } = card({ status: 'in_progress', review_round: 1 });
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
