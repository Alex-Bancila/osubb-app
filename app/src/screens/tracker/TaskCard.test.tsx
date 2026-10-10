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
  function opportunityCard(
    overrides: Partial<TaskPresentationRow>,
    memberId = 'candidate',
  ) {
    const task = toTaskPresentation(
      taskRow({ ...overrides, assignment_mode: 'public' }),
      new Date('2026-09-15'),
    );
    return render(
      <TaskCard
        task={task}
        allowInterest
        memberId={memberId}
        pending={false}
        onProgress={vi.fn()}
      />,
    );
  }
  it('keeps a Candidate’s queue line without actions once the queue closes', () => {
    opportunityCard({
      status: 'todo',
      queue_closed_at: '2026-09-15T10:00:00Z',
    });
    expect(screen.getByText('Stare înscriere')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Participă' }),
    ).not.toBeInTheDocument();
  });
  it.each(['completed', 'unfulfilled', 'cancelled'] as const)(
    'shows no queue line on a finished Task (%s): it is history (Audit D-1)',
    (status) => {
      opportunityCard({ status, assignments: [], visibleExecutor: null });
      expect(screen.queryByText('Stare înscriere')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Participă' }),
      ).not.toBeInTheDocument();
    },
  );
  it('shows no queue line on the Executor’s own card, only its stage (B14)', () => {
    opportunityCard({ status: 'todo' }, 'member');
    expect(screen.queryByText('Stare înscriere')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Participă' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Taskul este atribuit și așteaptă să fie început.'),
    ).toBeVisible();
  });
  it('shows a named Origin, the short Bucharest deadline and the current stage', () => {
    const { container } = card();
    expect(
      screen.getByRole('article', { name: 'Pregătește materialele' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Departament · Educațional')).toBeInTheDocument();
    // One meta row: the clock and the short date, on one line. "Termen:" is
    // said to a screen reader only, and the time zone is not repeated.
    const deadline = screen.getByText('mie., 16 sept. · 13:00');
    expect(deadline).toHaveAttribute('dateTime', '2026-09-16T10:00:00Z');
    expect(deadline.closest('[data-slot="task-meta"]')).not.toBeNull();
    expect(screen.getByText('Termen:')).toHaveClass('sr-only');
    expect(container).not.toHaveTextContent('ora României');
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
    card(
      {
        visibleExecutor: { memberId: 'member', fullName: 'Ioana Executor' },
      },
      vi.fn(),
      'someone-else',
    );

    expect(screen.getByText('Executor:')).toBeInTheDocument();
    expect(screen.getByText('Ioana Executor')).toBeInTheDocument();
  });

  it('distinguishes an unassigned Task from an unavailable Executor name', () => {
    const { unmount } = card({ assignments: [], visibleExecutor: null });
    expect(screen.getByText('Neatribuit')).toBeInTheDocument();
    unmount();

    card(
      { visibleExecutor: { memberId: 'member', fullName: null } },
      vi.fn(),
      'someone-else',
    );
    expect(screen.getByText('Nume indisponibil')).toBeInTheDocument();
  });

  it('omits the Executor line on the viewer’s own card (B2)', () => {
    card({
      visibleExecutor: { memberId: 'member', fullName: 'Ioana Popescu' },
    });
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Ioana Popescu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Începe taskul' })).toBeVisible();
  });

  it.each(['completed', 'unfulfilled'] as const)(
    'names the Executor who finished a %s Task to everyone else (Audit D-1, #861)',
    (status) => {
      card(
        {
          status,
          assignments: [],
          visibleExecutor: {
            memberId: 'ioana',
            fullName: 'Ioana Executor',
            isCurrent: false,
          },
        },
        vi.fn(),
        'manager',
      );
      expect(screen.getByText('Executor:')).toBeVisible();
      expect(screen.getByText('Ioana Executor')).toBeVisible();
      expect(screen.queryByText('Neatribuit')).toBeNull();
    },
  );

  it('names no Executor on the finished Task of the Member who did it (B2, #861)', () => {
    card(
      {
        status: 'completed',
        assignments: [],
        visibleExecutor: {
          memberId: 'member',
          fullName: 'Ioana Executor',
          isCurrent: false,
        },
      },
      vi.fn(),
      'member',
    );
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Ioana Executor')).toBeNull();
    // Who finished a Task no longer holds it: no Începe, Trimite or Renunță.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers no actions to a former Executor even on an open status (#861)', () => {
    card(
      {
        status: 'in_progress',
        visibleExecutor: {
          memberId: 'member',
          fullName: 'Ioana Executor',
          isCurrent: false,
        },
      },
      vi.fn(),
      'member',
    );
    expect(
      screen.queryByRole('button', { name: 'Trimite la verificare' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Renunță la task' }),
    ).toBeNull();
  });

  it.each(['completed', 'unfulfilled', 'cancelled'] as const)(
    'never reads "Neatribuit" on a finished Task (%s, B13, Audit D-1)',
    (status) => {
      // The RPC names only an open Assignment; an Evaluation ends it.
      card({ status, assignments: [], visibleExecutor: null }, vi.fn(), 'x');
      expect(screen.queryByText('Executor:')).toBeNull();
      expect(screen.queryByText('Neatribuit')).toBeNull();
    },
  );

  it('shows an Opportunity’s Executor line only once someone holds it (B12)', () => {
    const open = card(
      { assignment_mode: 'public', assignments: [], visibleExecutor: null },
      vi.fn(),
      'candidate',
    );
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Neatribuit')).toBeNull();
    open.unmount();

    card(
      {
        assignment_mode: 'public',
        status: 'in_progress',
        visibleExecutor: { memberId: 'member', fullName: 'Ioana Popescu' },
      },
      vi.fn(),
      'candidate',
    );
    expect(screen.getByText('Executor:')).toBeVisible();
    expect(screen.getByText('Ioana Popescu')).toBeVisible();
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
    expect(screen.getByText('Toamnă')).toHaveTextContent('Campanie: Toamnă');
    expect(screen.getByText('Modificări cerute')).toBeInTheDocument();
    expect(screen.getByText('Termen depășit')).toBeInTheDocument();
    // Overdue stays red: the date and its clock.
    const deadline = screen.getByText('lun., 14 sept. · 13:00');
    expect(deadline).toHaveClass('text-destructive', 'font-semibold');
    expect(deadline.parentElement?.querySelector('svg')).toHaveClass(
      'text-destructive',
    );
  });

  it('puts the status on the title’s row and the Group and Campaign on one muted line under it', () => {
    const { container } = card({
      campaign_id: 3,
      campaign: { name: 'Bugetare 2026–2027' },
    });
    const heading = container.querySelector('[data-slot="task-heading"]');
    expect(
      within(heading as HTMLElement).getByRole('heading', {
        name: 'Pregătește materialele',
      }),
    ).toBeVisible();
    expect(within(heading as HTMLElement).getByText('De făcut')).toBeVisible();
    // One line, whole: the Campaign's name is never cut to "Campanie: B…".
    const origin = container.querySelector('[data-slot="task-origin"]');
    expect(origin).toHaveTextContent(
      'Departament · Educațional·Campanie: Bugetare 2026–2027',
    );
    expect(origin).toHaveClass('flex-wrap', 'text-muted-foreground');
    expect(origin?.querySelector('.truncate')).toBeNull();
    expect(within(origin as HTMLElement).getByText('Campanie:')).toHaveClass(
      'sr-only',
    );
    // No chip line, and the title is not a block of reserved height.
    expect(container.querySelector('[data-slot="task-chips"]')).toBeNull();
    expect(
      (heading as Element).compareDocumentPosition(origin as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
      // R29a: Difficulty as stars, Nota as a number.
      const stars = screen.getByRole('img', {
        name: 'Dificultate 3 din 5',
      });
      // On the meta row, beside the deadline.
      const evaluation = stars.closest('p');
      expect(evaluation).toHaveTextContent(/^0 puncte\s*Nota 2$/);
      expect(evaluation?.closest('[data-slot="task-meta"]')).not.toBeNull();
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

  it('opens each Attached Link in a new tab with safe attributes, the bare label on a card (R46)', () => {
    card({
      links: [
        { label: 'Brief', url: 'https://drive.example/brief' },
        { label: 'Afiș', url: 'https://drive.example/afis' },
      ],
    });
    const link = screen.getByRole('link', {
      name: 'Brief (se deschide într-o filă nouă)',
    });
    expect(link).toHaveTextContent(/^Brief$/);
    expect(link).toHaveAttribute('href', 'https://drive.example/brief');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByRole('link', { name: 'Afiș (se deschide într-o filă nouă)' }),
    ).toHaveAttribute('href', 'https://drive.example/afis');
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

  /* CodeRabbit on #862: in the details sheet the card has no list to hand the
     receipt to; once the refetch shows the Member no longer holds the Task the
     give-up control leaves, and the card must keep the receipt. */
  it('keeps the give-up receipt on the card when no list takes it', async () => {
    const user = userEvent.setup();
    const task = (holder: string) =>
      toTaskPresentation(
        taskRow({
          status: 'todo',
          visibleExecutor: { memberId: holder, fullName: 'Membru' },
        }),
        new Date('2026-09-15T12:00:00Z'),
      );
    const props = { memberId: 'member', onProgress: vi.fn() };
    const { rerender } = render(<TaskCard task={task('member')} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    await user.type(screen.getByLabelText('Motivul renunțării'), 'Examen');
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );
    rerender(<TaskCard task={task('altcineva')} {...props} />);

    expect(
      screen.queryByRole('button', { name: 'Renunță la task' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ai renunțat la task.',
    );
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
      links: [{ label: 'Brief', url: 'https://drive.example/brief' }],
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
      links: [{ label: 'Brief', url: 'https://drive.example/brief' }],
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

  it('names the Executor by avatar and name; "Executor:" is for a screen reader', () => {
    card(
      { visibleExecutor: { memberId: 'member', fullName: 'Ioana Executor' } },
      vi.fn(),
      'someone-else',
    );
    const label = screen.getByText('Executor:');
    expect(label).toHaveClass('sr-only');
    expect(
      within(label.parentElement as HTMLElement).getByRole('button', {
        name: 'Profilul membrului Ioana Executor',
      }),
    ).toBeVisible();
    expect(label.closest('[data-slot="task-meta"]')).not.toBeNull();
  });

  it('keeps a long description to two lines; the details sheet has it whole', () => {
    card({ description: 'Descriere '.repeat(100) });
    expect(screen.getByText(/^Descriere Descriere/)).toHaveClass(
      'line-clamp-2',
    );
  });

  it('stacks the footer actions full-width in one column (T3)', () => {
    const { container } = card({ status: 'in_progress' });
    const footer = container.querySelector('[data-slot="card-footer"]');
    expect(footer).toHaveClass('mt-auto', 'grid', 'grid-cols-1');
    expect(
      screen.getByRole('button', { name: 'Trimite la verificare' }),
    ).toHaveClass('w-full');
    expect(screen.getByRole('button', { name: 'Renunță la task' })).toHaveClass(
      'w-full',
    );
  });
});
