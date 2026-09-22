vi.mock('./RequestDecisionQueue', () => ({ RequestDecisionQueue: () => null }));
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useRequestOrigins: vi.fn(),
  useMyCompletedWorkRequests: vi.fn(),
  useSubmitCompletedWork: vi.fn(),
}));

vi.mock('../../queries/completed-work-requests', () => hooks);
vi.mock('../tracker/TaskDetailsSheet', () => ({
  TaskDetailsSheet: ({ taskId }: { taskId: number | null }) =>
    taskId === null ? null : <p>Detalii task #{taskId}</p>,
}));

import CompletedWorkRequestScreen from './CompletedWorkRequestScreen';

describe('CompletedWorkRequestScreen', () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 1 });
    hooks.useRequestOrigins.mockReturnValue({
      data: [
        {
          key: 'department:edu',
          type: 'department',
          id: 'edu',
          name: 'Educațional',
        },
        { key: 'team:media', type: 'team', id: 'media', name: 'Echipa Media' },
        { key: 'project:7', type: 'project', id: '7', name: 'OSUBB Fest' },
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

  it('offers only the membership Origins supplied by the query', () => {
    render(<CompletedWorkRequestScreen />);

    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Alege grupul', 'Educațional', 'Echipa Media', 'OSUBB Fest']);
    expect(
      screen.getByRole('combobox', { name: 'Grup' }),
    ).toHaveAccessibleDescription(
      'Alege grupul pentru care ai lucrat: departamentul, echipa sau proiectul.',
    );
    expect(screen.queryByText('Financiar')).not.toBeInTheDocument();
  });

  it('submits the selected Origin and trimmed description, then confirms success', async () => {
    const user = userEvent.setup();
    render(<CompletedWorkRequestScreen />);

    await user.selectOptions(screen.getByLabelText('Grup'), 'project:7');
    await user.type(
      screen.getByLabelText('Descriere'),
      '  Am coordonat voluntarii.  ',
    );
    await user.click(screen.getByRole('button', { name: 'Trimite cererea' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      origin: {
        key: 'project:7',
        type: 'project',
        id: '7',
        name: 'OSUBB Fest',
      },
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
