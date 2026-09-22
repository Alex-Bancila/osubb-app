import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useRequestOrigins: vi.fn(),
  useMyCompletedWorkRequests: vi.fn(),
  useSubmitCompletedWork: vi.fn(),
}));

vi.mock('../../queries/completed-work-requests', () => hooks);

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
