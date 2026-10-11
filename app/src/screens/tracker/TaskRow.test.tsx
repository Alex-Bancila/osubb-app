import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { TaskRow } from './TaskRow';
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
  TaskInterestControls: ({
    children,
  }: {
    children: (parts: { status: ReactNode; action: ReactNode }) => ReactNode;
  }) =>
    children({
      status: <p>Loc în coadă</p>,
      action: <button>Participă</button>,
    }),
}));
import { taskRow } from '../../test/task-fixtures';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

/** The row as Taskurile mele draws it: detailed, anchored, the viewer's. */
function detailedRow(
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
      <TaskRow
        detailed
        anchor
        task={task}
        memberId={memberId}
        pending={false}
        onProgress={onProgress}
      />,
    ),
    onProgress,
  };
}

describe('The detailed Task row of a Member’s own lists', () => {
  function opportunityRow(
    overrides: Partial<TaskPresentationRow>,
    memberId = 'candidate',
    joinable = true,
  ) {
    const task = toTaskPresentation(
      taskRow({ ...overrides, assignment_mode: 'public' }),
      new Date('2026-09-15'),
    );
    return render(
      <TaskRow
        detailed
        task={task}
        allowInterest
        joinable={joinable}
        onOpenTask={vi.fn()}
        memberId={memberId}
        pending={false}
        onProgress={vi.fn()}
      />,
    );
  }
  it('keeps a Candidate’s queue line without actions once the queue closes', () => {
    opportunityRow({
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
      opportunityRow({ status, assignments: [], visibleExecutor: null });
      expect(screen.queryByText('Stare înscriere')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Participă' }),
      ).not.toBeInTheDocument();
    },
  );
  it('shows no queue line on the Executor’s own row, only its stage (B14)', () => {
    opportunityRow({ status: 'todo' }, 'member');
    expect(screen.queryByText('Stare înscriere')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Participă' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Taskul este atribuit și așteaptă să fie început.'),
    ).toBeVisible();
  });
  it('shows a named Origin, the short Bucharest deadline and the current stage', () => {
    const { container } = detailedRow();
    expect(
      screen.getByRole('article', { name: 'Pregătește materialele' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Departament · Educațional')).toBeInTheDocument();
    // One meta row: the clock and the short date, on one line. "Termen:" is
    // said to a screen reader only, and the time zone is not repeated.
    const deadline = screen.getByText('mie., 16 sept. · 13:00');
    expect(deadline).toHaveAttribute('dateTime', '2026-09-16T10:00:00Z');
    expect(deadline.closest('[data-slot="task-row-meta"]')).not.toBeNull();
    expect(screen.getByText('Termen:')).toHaveClass('sr-only');
    expect(container).not.toHaveTextContent('ora României');
    expect(
      screen.getByText('Taskul este atribuit și așteaptă să fie început.'),
    ).toBeInTheDocument();
  });

  it("locks a Private Group's chip, and no public one (#757)", async () => {
    const publicRow = detailedRow();
    expect(screen.queryByText('Privat')).toBeNull();
    publicRow.unmount();

    const { container } = detailedRow({
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
      <TaskRow
        detailed
        task={task}
        memberId="member"
        onProgress={onProgress}
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
    detailedRow(
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
    const { unmount } = detailedRow({ assignments: [], visibleExecutor: null });
    expect(screen.getByText('Neatribuit')).toBeInTheDocument();
    unmount();

    detailedRow(
      { visibleExecutor: { memberId: 'member', fullName: null } },
      vi.fn(),
      'someone-else',
    );
    expect(screen.getByText('Nume indisponibil')).toBeInTheDocument();
  });

  it('omits the Executor line on the viewer’s own row (B2)', () => {
    detailedRow({
      visibleExecutor: { memberId: 'member', fullName: 'Ioana Popescu' },
    });
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Ioana Popescu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Începe taskul' })).toBeVisible();
  });

  it.each(['completed', 'unfulfilled'] as const)(
    'names the Executor who finished a %s Task to everyone else (Audit D-1, #861)',
    (status) => {
      detailedRow(
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
    detailedRow(
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
    detailedRow(
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
      detailedRow(
        { status, assignments: [], visibleExecutor: null },
        vi.fn(),
        'x',
      );
      expect(screen.queryByText('Executor:')).toBeNull();
      expect(screen.queryByText('Neatribuit')).toBeNull();
    },
  );

  it('shows an Opportunity’s Executor line only once someone holds it (B12)', () => {
    const open = detailedRow(
      { assignment_mode: 'public', assignments: [], visibleExecutor: null },
      vi.fn(),
      'candidate',
    );
    expect(screen.queryByText('Executor:')).toBeNull();
    expect(screen.queryByText('Neatribuit')).toBeNull();
    open.unmount();

    detailedRow(
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
    detailedRow({
      kind: 'umbrella',
      assignments: [],
      visibleExecutor: { memberId: 'member', fullName: 'Nume imposibil' },
    });

    expect(screen.queryByText('Executor:')).not.toBeInTheDocument();
    expect(screen.queryByText('Nume imposibil')).not.toBeInTheDocument();
  });

  it('shows the independent feedback and overdue markers', () => {
    detailedRow({
      status: 'in_progress',
      review_round: 1,
      deadline: '2026-09-14T10:00:00Z',
      parent_task_id: 2,
      parent: { title: 'Recrutare' },
      campaign_id: 3,
      campaign: { name: 'Toamnă' },
    });
    expect(screen.getByText('Modificări cerute')).toBeInTheDocument();
    expect(screen.getByText('Termen depășit')).toBeInTheDocument();
    // Overdue stays red: the date and its clock.
    const deadline = screen.getByText('lun., 14 sept. · 13:00');
    expect(deadline).toHaveClass('text-destructive', 'font-semibold');
    expect(deadline.parentElement?.querySelector('svg')).toHaveClass(
      'text-destructive',
    );
  });

  it('keeps the title alone on its line: the Group chip and the status lead the one meta line under it', () => {
    const { container } = detailedRow({
      status: 'in_progress',
      deadline: '2026-09-14T10:00:00Z',
    });
    const body = container.querySelector('[data-slot="list-row-body"]');
    expect(body).toHaveTextContent(/^Pregătește materialele$/);
    expect(within(body as HTMLElement).queryByText('În lucru')).toBeNull();
    const metas = container.querySelectorAll('[data-slot="task-row-meta"]');
    expect(metas).toHaveLength(1);
    const meta = metas[0] as HTMLElement;
    // The fixed order: Group chip, status badges, then the deadline.
    const order = ['Departament · Educațional', 'În lucru', 'Termen depășit'];
    const facts = [
      ...order.map((text) => within(meta).getByText(text)),
      within(meta).getByText('lun., 14 sept. · 13:00'),
    ];
    for (let index = 1; index < facts.length; index += 1)
      expect(
        (facts[index - 1] as Element).compareDocumentPosition(
          facts[index] as Element,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // The chip, never the dotted origin line of the retired card.
    expect(container.querySelector('[data-slot="task-origin"]')).toBeNull();
    expect(container.querySelector('[data-slot="task-heading"]')).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('names the Group by its chip only: the Campaign, the Audience and the Umbrella are the details sheet’s', () => {
    detailedRow({
      assignment_mode: 'public',
      audience: 'org',
      parent_task_id: 2,
      parent: { title: 'Recrutare' },
      campaign_id: 3,
      campaign: { name: 'Toamnă' },
    });
    expect(screen.getByText('Departament · Educațional')).toBeVisible();
    expect(screen.queryByText('Toamnă')).toBeNull();
    expect(screen.queryByText('OSUBB')).toBeNull();
    expect(screen.queryByText(/Subtask din/)).toBeNull();
  });

  it.each(['unfulfilled', 'completed'] as const)(
    'distinguishes %s and retains zero evaluation points',
    (status) => {
      detailedRow({
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
      // At the end of the meta line.
      const evaluation = stars.closest('p');
      expect(evaluation).toHaveTextContent(/^0 puncte\s*Nota 2$/);
      const meta = evaluation?.closest('[data-slot="task-row-meta"]');
      expect(meta).not.toBeNull();
      expect(evaluation).toHaveClass('ml-auto');
      expect(meta?.lastElementChild).toBe(evaluation);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Termen depășit')).not.toBeInTheDocument();
    },
  );

  it('preserves long content and handles missing optional relations', () => {
    const title = 'Titlu'.repeat(100);
    const description = 'Descriere '.repeat(100);
    detailedRow({
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
    expect(screen.queryByText(/puncte/)).not.toBeInTheDocument();
  });

  it('offers keyboard-operable start only to the current Executor', async () => {
    const user = userEvent.setup();
    const { onProgress } = detailedRow();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Începe taskul' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onProgress).toHaveBeenCalledWith({ taskId: 1, action: 'start' });
  });

  it('offers submission for work in progress through the Submission Note dialog', async () => {
    const user = userEvent.setup();
    const { onProgress } = detailedRow({ status: 'in_progress' });
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
    const { container, unmount } = detailedRow();
    const stripe = container.querySelector<HTMLElement>(
      '[data-slot="task-stripe"]',
    );
    expect(stripe).toHaveAttribute('aria-hidden', 'true');
    expect(
      stripe
        ?.closest<HTMLElement>('article')
        ?.style.getPropertyValue('--task-stripe'),
    ).toBe('var(--dept-edu)');
    unmount();

    const organization = detailedRow({
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
        .querySelector<HTMLElement>('article')
        ?.style.getPropertyValue('--task-stripe'),
    ).toBe('var(--scope-org)');
    // Colour is never the only carrier: the chip names the Group.
    expect(screen.getByText('Organizație')).toBeVisible();
  });

  it('anchors the row of the list a deep link lands on, and no other copy', () => {
    const { container, unmount } = detailedRow();
    expect(container.querySelector('article')).toHaveAttribute('id', 'task-1');
    unmount();
    const task = toTaskPresentation(
      taskRow(),
      new Date('2026-09-15T12:00:00Z'),
    );
    const copy = render(
      <TaskRow
        detailed
        task={task}
        memberId="member"
        pending={false}
        onProgress={vi.fn()}
      />,
    );
    expect(copy.container.querySelector('article')).not.toHaveAttribute('id');
  });

  it('opens each Attached Link in a new tab with safe attributes, the bare label in a list (R46)', () => {
    detailedRow({
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
    const { unmount } = detailedRow({ status: 'in_review', submission });
    const note = screen.getByRole('region', { name: 'Notă la trimitere' });
    expect(note).toHaveTextContent('Varianta finală, cu sursele.');
    expect(note).not.toHaveTextContent('Prima variantă');
    expect(
      within(note).getByRole('link', {
        name: 'Surse (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();

    // Back in progress after a return: the row no longer shows it.
    const returned = detailedRow({
      status: 'in_progress',
      review_round: 1,
      submission,
    });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
    returned.unmount();

    // Never submitted: nothing to show.
    detailedRow({ status: 'in_review', submission: [] });
    expect(
      screen.queryByRole('region', { name: 'Notă la trimitere' }),
    ).not.toBeInTheDocument();
  });

  it('offers give-up only to the active Executor before review', () => {
    const { unmount } = detailedRow({ status: 'in_progress' });
    expect(
      screen.getByRole('button', { name: 'Renunță la task' }),
    ).toBeVisible();
    unmount();

    detailedRow({ status: 'in_review' });
    expect(
      screen.queryByRole('button', { name: 'Renunță la task' }),
    ).not.toBeInTheDocument();
  });

  /* CodeRabbit on #862: a row with no list to hand the receipt to; once the
     refetch shows the Member no longer holds the Task the give-up control
     leaves, and the row must keep the receipt. */
  it('keeps the give-up receipt on the row when no list takes it', async () => {
    const user = userEvent.setup();
    const task = (holder: string) =>
      toTaskPresentation(
        taskRow({
          status: 'todo',
          visibleExecutor: { memberId: holder, fullName: 'Membru' },
        }),
        new Date('2026-09-15T12:00:00Z'),
      );
    const props = { detailed: true, memberId: 'member', onProgress: vi.fn() };
    const { rerender } = render(<TaskRow task={task('member')} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    await user.type(screen.getByLabelText('Motivul renunțării'), 'Examen');
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );
    rerender(<TaskRow task={task('altcineva')} {...props} />);

    expect(
      screen.queryByRole('button', { name: 'Renunță la task' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ai renunțat la task.',
    );
  });

  it('names the Executor as a button that opens their Member Card', async () => {
    const user = userEvent.setup();
    detailedRow(
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
    detailedRow({}, vi.fn(), 'former');
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
    detailedRow({}, onProgress);
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
    const { container } = detailedRow({
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
    const { container } = detailedRow({
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
    detailedRow(
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
    expect(label.closest('[data-slot="task-row-meta"]')).not.toBeNull();
  });

  it('keeps a long description to one line under the meta line; the details sheet has it whole', () => {
    const { container } = detailedRow({
      description: 'Descriere '.repeat(100),
    });
    const description = screen.getByText(/^Descriere Descriere/);
    expect(description).toHaveClass('line-clamp-1');
    expect(description).not.toHaveClass('line-clamp-2');
    const meta = container.querySelector('[data-slot="task-row-meta"]');
    expect(
      (meta as Element).compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('puts the Executor’s actions at the row’s end, above its open area: full width on a phone, natural width from sm', () => {
    const task = toTaskPresentation(
      taskRow({ status: 'in_progress' }),
      new Date('2026-09-15T12:00:00Z'),
    );
    const { container } = render(
      <TaskRow
        detailed
        task={task}
        memberId="member"
        onProgress={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );
    const row = screen.getByRole('article');
    const actions = container.querySelector('[data-slot="task-row-actions"]');
    // A cell of the row beside its content, not a line inside it.
    expect(actions?.parentElement).toBe(row);
    expect(actions?.closest('[data-slot="list-row"]')).toBeNull();
    expect(row).toHaveClass('grid', 'sm:grid-cols-[minmax(0,1fr)_auto]');
    expect(actions).toHaveClass(
      'relative',
      'z-10',
      'sm:col-start-2',
      'sm:row-start-1',
      'sm:self-center',
    );
    const submit = screen.getByRole('button', {
      name: 'Trimite la verificare',
    });
    const giveUp = screen.getByRole('button', { name: 'Renunță la task' });
    expect(actions).toContainElement(submit);
    expect(actions).toContainElement(giveUp);
    expect(submit).toHaveClass('min-h-11', 'w-full');
    expect(giveUp).toHaveClass('min-h-11', 'w-full');
    // The title still opens the Task, its hit area stretched over the row.
    expect(
      within(row).getByRole('button', { name: 'Pregătește materialele' }),
    ).toHaveClass('after:absolute', 'after:inset-0');
  });

  it('puts "Participă" at the row’s end and what the queue says in its content', () => {
    const { container } = opportunityRow({ status: 'todo', assignments: [] });
    const actions = container.querySelector('[data-slot="task-row-actions"]');
    expect(actions).toContainElement(
      screen.getByRole('button', { name: 'Participă' }),
    );
    expect(actions).toHaveClass('relative', 'z-10', 'sm:col-start-2');
    const footer = container.querySelector('[data-slot="list-row-footer"]');
    expect(
      within(footer as HTMLElement).getByText('Loc în coadă'),
    ).toBeVisible();
    expect(actions).not.toHaveTextContent('Loc în coadă');
  });

  it('says a Task is for its Group’s members where the join button would be (R26)', () => {
    const { container } = opportunityRow(
      { status: 'todo', assignments: [] },
      'candidate',
      false,
    );
    expect(
      container.querySelector('[data-slot="audience-notice"]'),
    ).toHaveTextContent('Doar pentru membrii grupului');
    expect(screen.queryByRole('button', { name: 'Participă' })).toBeNull();
    expect(
      container.querySelector('[data-slot="task-row-actions"]'),
    ).toBeNull();
  });

  it('draws no actions cell when the viewer has nothing to do', () => {
    const { container } = detailedRow({}, vi.fn(), 'former');
    expect(
      container.querySelector('[data-slot="task-row-actions"]'),
    ).toBeNull();
  });
});

function renderRow(
  overrides: Partial<TaskPresentationRow> = {},
  onOpenTask = vi.fn(),
) {
  const task = toTaskPresentation(
    taskRow({
      title: 'Logistică Tabăra de Toamnă',
      status: 'completed',
      completed_at: '2026-09-08T10:00:00Z',
      deadline: '2026-09-08T20:59:00Z',
      evaluations: [
        { id: 1, difficulty: 3, rating: 5, points: 15, reversed_at: null },
      ],
      visibleExecutor: {
        memberId: 'maria',
        fullName: 'Maria Dobre',
        nickname: null,
      },
      ...overrides,
    }),
    new Date('2026-09-28T12:00:00Z'),
  );
  render(<TaskRow task={task} onOpenTask={onOpenTask} />);
  return { onOpenTask, row: screen.getByRole('article') };
}

describe('TaskRow (#846, layout T1)', () => {
  it('is a ListRow: the title across the row, one meta line under it with the points at its end', () => {
    const { row } = renderRow();
    expect(row).toHaveAccessibleName('Logistică Tabăra de Toamnă');
    const listRow = row.querySelector('[data-slot="list-row"]');
    expect(listRow).not.toBeNull();
    const body = row.querySelector('[data-slot="list-row-body"]');
    expect(body).toHaveTextContent(/^Logistică Tabăra de Toamnă$/);
    // The title has the whole width: no value column beside it to squeeze it
    // into three short lines, and no balanced wrapping.
    expect(row.querySelector('[data-slot="list-row-value"]')).toBeNull();
    expect(body?.querySelector('h2')).toHaveClass('wrap-break-word');
    expect(body?.querySelector('h2')).not.toHaveClass(
      'wrap-anywhere',
      'text-balance',
    );
    // One meta line, spanning the row: Group, status, deadline, Executor,
    // and the points last, pushed to the line's end.
    const footer = row.querySelector('[data-slot="list-row-footer"]');
    const meta = within(footer as HTMLElement);
    expect(
      footer?.querySelectorAll('[data-slot="task-row-meta"]'),
    ).toHaveLength(1);
    expect(meta.getByText('Finalizat')).toBeVisible();
    // The short date; "Termen:" and "Executor:" are for a screen reader.
    expect(meta.getByText('mar., 8 sept. · 23:59')).toBeVisible();
    expect(meta.getByText('Termen:')).toHaveClass('sr-only');
    expect(meta.getByText('Executor:')).toHaveClass('sr-only');
    expect(
      meta.getByRole('button', { name: 'Profilul membrului Maria Dobre' }),
    ).toBeVisible();
    const points = footer?.querySelector('[data-slot="task-row-points"]');
    expect(points).toHaveTextContent('15puncte');
    expect(points).toHaveClass('ml-auto');
    expect(points?.parentElement?.lastElementChild).toBe(points);
  });

  it('is one button for the Task, named by its title, stretched over the row', async () => {
    const user = userEvent.setup();
    const { onOpenTask, row } = renderRow();
    const open = within(row).getByRole('button', {
      name: 'Logistică Tabăra de Toamnă',
    });
    expect(open).toHaveClass('after:absolute', 'after:inset-0');
    // The only other button is the Executor's Member Card, above that area.
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(
      within(row).getByRole('button', {
        name: 'Profilul membrului Maria Dobre',
      }),
    ).toHaveClass('relative', 'z-10');
    await user.click(open);
    expect(onOpenTask).toHaveBeenCalledWith(1);
  });

  it('opens the Executor’s Member Card, not the Task, from their name', async () => {
    const user = userEvent.setup();
    const { onOpenTask, row } = renderRow();
    await user.click(
      within(row).getByRole('button', {
        name: 'Profilul membrului Maria Dobre',
      }),
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('Maria Dobre');
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('uses the kit’s box radius and shows the ring on the row when its button has focus', () => {
    const { row } = renderRow();
    expect(row).toHaveClass('rounded-md');
    expect(row).not.toHaveClass('rounded-lg');
    expect(row.className).toContain(
      'has-[[data-slot=task-row-open]:focus-visible]:outline-2',
    );
  });

  it('shows no points when the Task has none yet', () => {
    const { row } = renderRow({ status: 'todo', evaluations: [] });
    expect(row.querySelector('[data-slot="task-row-points"]')).toBeNull();
    expect(within(row).getByText('Executor:')).toBeInTheDocument();
  });
});
