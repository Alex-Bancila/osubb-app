import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({
  useExpressTaskInterest: vi.fn(),
  useWithdrawTaskInterest: vi.fn(),
}));
// No query client here: a control that read its own queue (#1133) would
// fail to render at all. The client is never reached.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/task-interest', () => ({
  useExpressTaskInterest: hooks.useExpressTaskInterest,
  TaskInterestError: Error,
}));
vi.mock('../../queries/task-withdrawal', () => ({
  useWithdrawTaskInterest: hooks.useWithdrawTaskInterest,
}));
import type { OwnTaskQueue } from '../../queries/task-queue';
import { toTaskPresentation } from './task-presentation';
import { taskRow } from '../../test/task-fixtures';
import { TaskInterestControls } from './TaskInterestControls';

const PENDING_SECOND: OwnTaskQueue = { status: 'pending', position: 2 };
const NOT_ENROLLED: OwnTaskQueue = { status: null, position: null };

describe('Withdraw and rejoin', () => {
  beforeEach(() => {
    hooks.useExpressTaskInterest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ position: 7 }),
    });
    hooks.useWithdrawTaskInterest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('explains the queued stage when controls are available', () => {
    render(
      <TaskInterestControls
        taskId={1}
        task={toTaskPresentation(taskRow(), new Date('2026-09-01'))}
        queue={PENDING_SECOND}
      />,
    );
    expect(
      screen.getByText('Ești pe locul 2 în lista de așteptare.'),
    ).toBeVisible();
    // One queue sentence (B21).
    expect(screen.queryByText('Te-ai înscris pe locul 2.')).toBeNull();
  });

  it('shows the join button alone to a Member who is not enrolled (B12)', () => {
    render(
      <TaskInterestControls
        taskId={1}
        task={toTaskPresentation(
          taskRow({ assignment_mode: 'public', assignments: [] }),
          new Date('2026-09-01'),
        )}
        queue={NOT_ENROLLED}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Vreau să particip' }),
    ).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByText(/Nu ești înscris|Taskul este de făcut/),
    ).toBeNull();
  });

  // #1133: the state is the row's, so a new row state redraws the controls
  // without any read of their own.
  it('takes its state from the queue it is given, and follows it', () => {
    const { rerender } = render(
      <TaskInterestControls taskId={1} queue={NOT_ENROLLED} />,
    );
    expect(
      screen.getByRole('button', { name: 'Vreau să particip' }),
    ).toBeVisible();

    rerender(<TaskInterestControls taskId={1} queue={PENDING_SECOND} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Te-ai înscris pe locul 2.',
    );
    expect(
      screen.getByRole('button', { name: 'Retrage înscrierea' }),
    ).toBeVisible();

    // The place is not known yet: the line says so, the button stays.
    rerender(
      <TaskInterestControls
        taskId={1}
        queue={{ status: 'pending', position: null }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Înscris în lista de așteptare. Poziția se actualizează.',
    );

    rerender(
      <TaskInterestControls
        taskId={1}
        queue={{ status: 'closed', position: null }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Înscriere închisă.');
  });

  it('withdraws without a reason, then reports the new server position on rejoin', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskInterestControls taskId={1} queue={PENDING_SECOND} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Retrage înscrierea' }),
    );
    expect(hooks.useWithdrawTaskInterest().mutateAsync).toHaveBeenCalledWith(1);
    rerender(
      <TaskInterestControls
        taskId={1}
        queue={{ status: 'withdrawn', position: null }}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Înscrie-te din nou' }),
    );
    expect(
      screen.getByText('Te-ai înscris pe locul 7 în lista de așteptare.'),
    ).toBeVisible();
  });

  it('always confirms a first join with the queue place, never an Executor selection (R9)', async () => {
    const user = userEvent.setup();
    render(<TaskInterestControls taskId={1} queue={NOT_ENROLLED} />);
    await user.click(screen.getByRole('button', { name: 'Vreau să particip' }));
    expect(hooks.useExpressTaskInterest().mutateAsync).toHaveBeenCalledWith(1);
    expect(
      screen.getByText('Te-ai înscris pe locul 7 în lista de așteptare.'),
    ).toBeVisible();
    expect(
      screen.queryByText('Ai fost selectat ca Executor.'),
    ).not.toBeInTheDocument();
  });

  it('preserves the queue state on failure and prevents duplicate pending clicks', async () => {
    const user = userEvent.setup();
    let reject: (error: Error) => void = () => {};
    const mutateAsync = vi.fn(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    hooks.useWithdrawTaskInterest.mockReturnValue({ mutateAsync });
    render(<TaskInterestControls taskId={1} queue={PENDING_SECOND} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toBeDisabled();
    await user.click(screen.getByRole('button'));
    expect(mutateAsync).toHaveBeenCalledOnce();
    reject(new Error('Taskul s-a schimbat.'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Taskul s-a schimbat.',
    );
    expect(screen.getByText('Te-ai înscris pe locul 2.')).toBeVisible();
  });
});
