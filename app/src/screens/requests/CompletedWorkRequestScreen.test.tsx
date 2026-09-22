vi.mock('./RequestDecisionQueue', () => ({ RequestDecisionQueue: () => null }));
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useRequestOrigins: vi.fn(),
  useMyCompletedWorkRequests: vi.fn(),
  useSubmitCompletedWork: vi.fn(),
}));

vi.mock('../../queries/completed-work-requests', () => hooks);
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

import CompletedWorkRequestScreen from './CompletedWorkRequestScreen';

const optionTexts = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('CompletedWorkRequestScreen', () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 1 });
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
          description: 'Activitate în așteptare',
          status: 'pending',
          decision_note: null,
          task_id: null,
        },
        {
          id: 2,
          description: 'Activitate aprobată',
          status: 'approved',
          decision_note: 'Mulțumim pentru contribuție.',
          task_id: 42,
        },
        {
          id: 3,
          description: 'Activitate respinsă',
          status: 'rejected',
          decision_note: 'Adaugă detalii despre rezultat.',
          task_id: null,
        },
      ],
    });
    render(<CompletedWorkRequestScreen />);
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
    render(<CompletedWorkRequestScreen />);

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
    render(<CompletedWorkRequestScreen />);

    expect(
      screen.getByRole('button', { name: 'Trimite cererea' }),
    ).toBeDisabled();
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
    render(<CompletedWorkRequestScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Descrierea este obligatorie.',
    );
  });
});
