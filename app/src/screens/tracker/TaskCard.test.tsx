import { render, screen, within } from '@testing-library/react';
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
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

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

  it("locks a Private Group's chip, and no public one (#757)", async () => {
    const publicCard = card();
    expect(screen.queryByText('Privat')).toBeNull();
    publicCard.unmount();

    const { container } = card({
      group: {
        name: 'Audit',
        short: null,
        color: null,
        category: 'team',
        path: [1, 22],
        is_organization: false,
        is_private: true,
      },
    });
    const chip = screen.getByText('Echipă · Audit')
      .parentElement as HTMLElement;
    expect(within(chip).getByText('Privat')).toBeInTheDocument();
    expect(within(chip).getByTitle('Grup privat')).toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('the history variant is read-only: its record replaces the Executor line, stage and actions', () => {
    const onProgress = vi.fn();
    const task = toTaskPresentation(
      taskRow({ status: 'in_progress', assignment_mode: 'public' }),
      new Date('2026-09-15T12:00:00Z'),
    );
    render(
      <TaskCard
        task={task}
        memberId="member"
        onProgress={onProgress}
        anchor={false}
        history={<p>Atribuire activă</p>}
      />,
    );
    expect(screen.getByText('Atribuire activă')).toBeInTheDocument();
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Stare înscriere')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('article')).not.toHaveAttribute('id');
  });

  it('shows the active Executor name on an ordinary Task', () => {
    card({
      visibleExecutor: { memberId: 'member', fullName: 'Ioana Executor' },
    });

    expect(screen.getByText('Executor:')).toBeInTheDocument();
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

    expect(screen.queryByText('Executor:')).not.toBeInTheDocument();
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
    expect(onProgress).toHaveBeenCalledWith({ taskId: 1, action: 'start' });
  });

  it('offers submission for work in progress through the Submission Note dialog', async () => {
    const user = userEvent.setup();
    const { onProgress } = card({ status: 'in_progress' });
    await user.click(
      screen.getByRole('button', { name: 'Trimite la verificare' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Trimite la verificare',
    });
    expect(onProgress).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: 'Trimite la verificare' }),
    );
    expect(onProgress).toHaveBeenCalledWith({
      taskId: 1,
      action: 'submit',
      note: null,
      linkLabel: null,
      linkUrl: null,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Taskul a fost trimis la verificare.',
    );
  });

  it('paints the Origin Group stripe, OSUBB red for the Organization Group', () => {
    const { container, unmount } = card();
    const stripe = container.querySelector<HTMLElement>(
      '[data-slot="task-stripe"]',
    );
    expect(stripe).toHaveAttribute('aria-hidden', 'true');
    expect(
      stripe
        ?.closest<HTMLElement>('[data-slot="card"]')
        ?.style.getPropertyValue('--task-stripe'),
    ).toBe('var(--dept-edu)');
    unmount();

    const organization = card({
      audience: 'org',
      assignment_mode: 'public',
      group: {
        name: 'Organizație',
        short: 'ORG',
        color: '#123456',
        category: 'org',
        path: [5],
        is_organization: true,
      },
    });
    expect(
      organization.container
        .querySelector<HTMLElement>('[data-slot="card"]')
        ?.style.getPropertyValue('--task-stripe'),
    ).toBe('var(--scope-org)');
    // Colour is never the only carrier: the chips name the Group and Audience.
    expect(screen.getByText('Organizație')).toBeVisible();
    expect(screen.getByText('OSUBB')).toBeVisible();
  });

  it('shows the OSUBB chip only on a public org-Audience Task (R26)', () => {
    const shows = (overrides: Partial<TaskPresentationRow>) => {
      const { unmount } = card(overrides);
      const found = screen.queryByText('OSUBB') !== null;
      unmount();
      return found;
    };
    expect(shows({ assignment_mode: 'public', audience: 'org' })).toBe(true);
    expect(shows({ assignment_mode: 'public', audience: 'local' })).toBe(false);
    // A direct Task is local only: a stale org Audience says nothing.
    expect(shows({ assignment_mode: 'direct', audience: 'org' })).toBe(false);
  });

  it('anchors the list card for the deep link, never the sheet copy', () => {
    const { container, unmount } = card();
    expect(container.querySelector('article')).toHaveAttribute('id', 'task-1');
    unmount();
    const task = toTaskPresentation(
      taskRow(),
      new Date('2026-09-15T12:00:00Z'),
    );
    const sheet = render(
      <TaskCard
        task={task}
        memberId="member"
        pending={false}
        onProgress={vi.fn()}
        anchor={false}
      />,
    );
    expect(sheet.container.querySelector('article')).not.toHaveAttribute('id');
  });

  it('opens the Attached Link in a new tab with safe attributes', () => {
    card({ link_label: 'Brief', link_url: 'https://drive.example/brief' });
    const link = screen.getByRole('link', {
      name: 'Brief (se deschide într-o filă nouă)',
    });
    expect(link).toHaveAttribute('href', 'https://drive.example/brief');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the latest Submission Note while the Task is in review', () => {
    const submission = [
      {
        id: 3,
        kind: 'submitted',
        note: 'Prima variantă',
        details: {},
        occurred_at: '2026-09-14T10:00:00Z',
      },
      {
        id: 9,
        kind: 'submitted',
        note: 'Varianta finală, cu sursele.',
        details: {
          link_label: 'Surse',
          link_url: 'https://drive.example/surse',
        },
        occurred_at: '2026-09-15T10:00:00Z',
      },
    ];
    const { unmount } = card({ status: 'in_review', submission });
    const note = screen.getByRole('region', { name: 'Notă la trimitere' });
    expect(note).toHaveTextContent('Varianta finală, cu sursele.');
    expect(note).not.toHaveTextContent('Prima variantă');
    expect(
      within(note).getByRole('link', {
        name: 'Surse (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();

    // Back in progress after a return: the card no longer shows it.
    const returned = card({
      status: 'in_progress',
      review_round: 1,
      submission,
    });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
    returned.unmount();

    // Never submitted: nothing to show.
    card({ status: 'in_review', submission: [] });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
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

  it('names the Executor as a button that opens their Member Card', async () => {
    const user = userEvent.setup();
    card(
      {
        visibleExecutor: {
          memberId: 'member',
          fullName: 'Ioana Pop',
          nickname: 'Ioana',
        },
      },
      vi.fn(),
      'someone-else',
    );
    await user.click(
      screen.getByRole('button', { name: 'Profilul membrului Ioana' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Ioana' })).toBeVisible();
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
    const { container } = card({
      status: 'in_progress',
      review_round: 1,
      audience: 'org',
      campaign_id: 3,
      campaign: { name: 'Toamnă' },
      link_label: 'Brief',
      link_url: 'https://drive.example/brief',
      visibleExecutor: { memberId: 'member', fullName: 'Ana Pop' },
    });
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it('passes automated accessibility checks with a Submission Note in review', async () => {
    const { container } = card({
      status: 'in_review',
      link_label: 'Brief',
      link_url: 'https://drive.example/brief',
      submission: [
        {
          id: 2,
          kind: 'submitted',
          note: 'Gata de verificat.',
          details: { link_label: 'Surse', link_url: 'https://drive.example/s' },
          occurred_at: '2026-09-15T10:00:00Z',
        },
      ],
    });
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
