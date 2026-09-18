import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  candidates: vi.fn(),
  selection: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}));

vi.mock('../../queries/task-candidate-selection', () => ({
  usePendingTaskCandidates: hooks.candidates,
  useSelectTaskCandidate: () => hooks.selection,
}));

import { TaskCandidateSelector } from './TaskCandidateSelector';

describe('Task candidate selector', () => {
  beforeEach(() => {
    hooks.selection.isPending = false;
    hooks.selection.mutateAsync.mockReset().mockResolvedValue({ id: 17 });
    hooks.candidates.mockReturnValue({
      data: [
        {
          id: 31,
          memberId: 'member-1',
          memberName: 'Ana Pop',
          joinedAt: '2026-09-18T08:00:00Z',
        },
        {
          id: 32,
          memberId: 'member-2',
          memberName: 'Mihai Ionescu',
          joinedAt: '2026-09-18T09:00:00Z',
        },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('requires one queued candidate and selects them without closing the queue', async () => {
    const user = userEvent.setup();
    render(<TaskCandidateSelector taskId={17} />);

    const submit = screen.getByRole('button', { name: 'Alege executorul' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Ana Pop/ }));
    await user.click(submit);

    expect(hooks.selection.mutateAsync).toHaveBeenCalledWith({
      taskId: 17,
      candidateId: 31,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ana Pop este acum executorul taskului.',
    );
    expect(screen.getByText(/coada rămâne deschisă/i)).toBeVisible();
  });

  it('preserves the selection and refreshes the queue after a race conflict', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue(undefined);
    hooks.candidates.mockReturnValue({
      ...hooks.candidates(),
      refetch,
    });
    hooks.selection.mutateAsync.mockRejectedValue(
      Object.assign(
        new Error('Coada s-a schimbat. Lista a fost actualizată.'),
        {
          kind: 'conflict',
        },
      ),
    );
    render(<TaskCandidateSelector taskId={17} />);

    const ana = screen.getByRole('radio', { name: /Ana Pop/ });
    await user.click(ana);
    await user.click(screen.getByRole('button', { name: 'Alege executorul' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Coada s-a schimbat.',
    );
    expect(refetch).toHaveBeenCalledOnce();
    expect(ana).toBeChecked();
  });

  it('does not expose unexpected backend details', async () => {
    const user = userEvent.setup();
    hooks.selection.mutateAsync.mockRejectedValue(
      new Error('private SQL function details'),
    );
    render(<TaskCandidateSelector taskId={17} />);

    await user.click(screen.getByRole('radio', { name: /Ana Pop/ }));
    await user.click(screen.getByRole('button', { name: 'Alege executorul' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut schimba executorul. Încearcă din nou.',
    );
    expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  });

  it('shows bounded loading, error and empty states', async () => {
    const refetch = vi.fn();
    hooks.candidates.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch,
    });
    const { rerender } = render(<TaskCandidateSelector taskId={17} />);
    expect(screen.getByRole('status')).toHaveTextContent('Se încarcă coada');

    hooks.candidates.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    rerender(<TaskCandidateSelector taskId={17} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Reîncarcă lista' }),
    );
    expect(refetch).toHaveBeenCalledOnce();

    hooks.candidates.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch,
    });
    rerender(<TaskCandidateSelector taskId={17} />);
    expect(screen.getByText('Nu există persoane în coadă.')).toBeVisible();
  });

  it('uses semantic controls with no accessibility violations', async () => {
    const { container } = render(<TaskCandidateSelector taskId={17} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
