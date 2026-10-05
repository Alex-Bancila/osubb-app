vi.mock('./RequestDecisionQueue', () => ({
  // A visible stub, not `null`: tests below need to see it render regardless
  // of whether the submission form is showing (#631's decision queue stays
  // untouched by the level gate).
  RequestDecisionQueue: ({ showEmpty }: { showEmpty?: boolean }) => (
    <div
      role="region"
      aria-label="Coadă decizii stub"
      data-show-empty={String(Boolean(showEmpty))}
    />
  ),
}));
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));

const hooks = vi.hoisted(() => ({
  useRequestOrigins: vi.fn(),
  useMyCompletedWorkRequests: vi.fn(),
  useSubmitCompletedWork: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../../queries/completed-work-requests', () => hooks);
vi.mock('../../lib/auth', () => ({ useAuth: hooks.useAuth }));
// capabilities.ts (submitsWorkRequests) pulls in the shared client transitively;
// it is never called by this view, so an inert stub is enough to satisfy it.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
// Readable Groups name each option's parent: Echipa Media sits under
// Educațional; OSUBB Fest is top-level.
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({
    data: new Map([
      [4, { id: 4, name: 'Educațional', path: [4] }],
      [21, { id: 21, name: 'Echipa Media', path: [4, 21] }],
      [30, { id: 30, name: 'OSUBB Fest', path: [30] }],
    ]),
  }),
}));
vi.mock('../tracker/TaskDetailsSheet', () => ({
  TaskDetailsSheet: ({ taskId }: { taskId: number | null }) =>
    taskId === null ? null : <p>Detalii task #{taskId}</p>,
}));

import { RequestsView } from './RequestsView';

const optionTexts = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent);

/** The view as Taskuri shows it at `?vedere=cereri` (#973). */
function show() {
  return render(
    <MemoryRouter initialEntries={['/tracker?vedere=cereri']}>
      <RequestsView />
    </MemoryRouter>,
  );
}

describe('RequestsView', () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 1 });
    hooks.useAuth.mockReturnValue({
      claims: { member_role: 'voluntar', member_level: 1 },
    });
    hooks.useRequestOrigins.mockReturnValue({
      data: [
        { id: 21, name: 'Echipa Media', path: [4, 21] },
        { id: 4, name: 'Educațional', path: [4] },
        { id: 30, name: 'OSUBB Fest', path: [30] },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.useMyCompletedWorkRequests.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.useSubmitCompletedWork.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('shows pending, approved and rejected requests, notes and the created Task', async () => {
    hooks.useMyCompletedWorkRequests.mockReturnValue({
      data: [
        {
          id: 1,
          group_id: 21,
          description: 'Activitate în așteptare',
          status: 'pending',
          decision_note: null,
          task_id: null,
        },
        {
          id: 2,
          group_id: 30,
          description: 'Activitate aprobată',
          status: 'approved',
          decision_note: 'Mulțumim pentru contribuție.',
          task_id: 42,
        },
        {
          id: 3,
          group_id: 99,
          description: 'Activitate respinsă',
          status: 'rejected',
          decision_note: 'Adaugă detalii despre rezultat.',
          task_id: null,
        },
      ],
    });
    show();
    // Each row names the Group it was filed for (#855, B32), a Child Group
    // with its parent; a Group no longer readable leaves no empty line.
    const rows = screen.getAllByRole('listitem');
    expect(
      rows.map(
        (row) => row.querySelector('[data-slot="request-group"]')?.textContent,
      ),
    ).toEqual(['Echipa Media · Educațional', 'OSUBB Fest', undefined]);
    // #1012 (R37): the decided Requests are on screen, so the requester's
    // "Cerere aprobată" (about its Task) and "Cerere respinsă" are read.
    expect(readNotificationsAbout).toHaveBeenCalledWith([
      'completed_work_request:2',
      'task:42',
      'completed_work_request:3',
    ]);
    expect(screen.getByText('În așteptare')).toBeVisible();
    expect(screen.getByText('Aprobată')).toBeVisible();
    expect(screen.getByText('Respinsă')).toBeVisible();
    expect(screen.getByText('Adaugă detalii despre rezultat.')).toBeVisible();
    expect(screen.getByText('Motivul respingerii:')).toBeVisible();
    expect(screen.getByText('Mulțumim pentru contribuție.')).toBeVisible();
    expect(screen.getByText('Notă:')).toBeVisible();
    // Each state is told by an icon and its word, not by colour alone.
    for (const [label, status] of [
      ['În așteptare', 'pending'],
      ['Aprobată', 'approved'],
      ['Respinsă', 'rejected'],
    ] as const) {
      const badge = screen.getByText(label);
      expect(badge).toHaveAttribute('data-status', status);
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    await userEvent.click(
      screen.getByRole('button', { name: 'Deschide taskul #42' }),
    );
    expect(screen.getByText('Detalii task #42')).toBeVisible();
  });

  it('offers a searchable Grup picker of exactly the supplied Groups, each with its parent', async () => {
    const user = userEvent.setup();
    show();

    const box = screen.getByRole('combobox', { name: 'Grup' });
    expect(box).toHaveAccessibleDescription(
      'Alege grupul pentru care ai lucrat: departamentul, echipa sau proiectul.',
    );
    await user.click(box);
    await screen.findByRole('listbox');
    expect(optionTexts()).toEqual([
      'Echipa Media· Educațional',
      'Educațional',
      'OSUBB Fest',
    ]);
    await user.type(
      await screen.findByRole('combobox', { name: 'Caută un grup' }),
      'fest',
    );
    await waitFor(() => expect(optionTexts()).toEqual(['OSUBB Fest']));
  });

  it('submits the selected Group and trimmed description, then confirms success', async () => {
    const user = userEvent.setup();
    show();

    const send = screen.getByRole('button', { name: 'Trimite cererea' });
    expect(send).toBeDisabled();
    // The #842 form submit: full width on a phone, its own width from sm.
    expect(send).toHaveClass('w-full', 'sm:w-auto');
    await user.click(screen.getByRole('combobox', { name: 'Grup' }));
    await user.click(
      await screen.findByRole('option', { name: /^Echipa Media/ }),
    );
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('combobox', { name: 'Grup' })).toHaveTextContent(
      'Echipa Media',
    );
    await user.type(
      screen.getByLabelText('Descriere'),
      '  Am coordonat voluntarii.  ',
    );
    await user.click(screen.getByRole('button', { name: 'Trimite cererea' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      origin: { id: 21, name: 'Echipa Media', path: [4, 21] },
      description: 'Am coordonat voluntarii.',
    });
    expect(
      await screen.findByText(/apare în Cererile mele/),
    ).toBeInTheDocument();
  });

  it('shows a safe message for PT400 description errors', () => {
    hooks.useSubmitCompletedWork.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: true,
      error: { code: 'PT400', message: 'description_required' },
    });
    show();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Descrierea este obligatorie.',
    );
  });

  it('has no page header of its own: Taskuri’s frames it (#973)', () => {
    show();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Activitatea ta' }),
    ).toBeVisible();
  });

  it.each([1, 4])(
    'shows the submission form and Cererile mele at level %i (#631)',
    (level) => {
      hooks.useAuth.mockReturnValue({
        claims: { member_role: 'voluntar', member_level: level },
      });
      show();

      expect(
        screen.getByRole('combobox', { name: 'Grup' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Trimite cererea' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Cererile mele' }),
      ).toBeInTheDocument();
      // The decision queue is unrelated to the level gate and still renders,
      // hidden while there is nothing to decide.
      expect(
        screen.getByRole('region', { name: 'Coadă decizii stub' }),
      ).toHaveAttribute('data-show-empty', 'false');
    },
  );

  it.each([5, 6, 9])(
    'hides the submission form and Cererile mele at level %i, keeping the decision queue (#631)',
    (level) => {
      hooks.useAuth.mockReturnValue({
        claims: { member_role: 'bc', member_level: level },
      });
      show();

      expect(
        screen.queryByRole('combobox', { name: 'Grup' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Trimite cererea' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Cererile mele' }),
      ).not.toBeInTheDocument();
      // The decision queue is the view: it says so when it is empty (B30).
      expect(
        screen.getByRole('region', { name: 'Coadă decizii stub' }),
      ).toHaveAttribute('data-show-empty', 'true');
    },
  );
});
