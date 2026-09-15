import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({
  useTaskQueue: vi.fn(),
  useExpressTaskInterest: vi.fn(),
  useWithdrawTaskInterest: vi.fn(),
}));
vi.mock('../../queries/task-queue', () => ({
  useTaskQueue: hooks.useTaskQueue,
}));
vi.mock('../../queries/task-interest', () => ({
  useExpressTaskInterest: hooks.useExpressTaskInterest,
  TaskInterestError: Error,
}));
vi.mock('../../queries/task-withdrawal', () => ({
  useWithdrawTaskInterest: hooks.useWithdrawTaskInterest,
}));
import { toTaskPresentation } from './task-presentation';
import { taskRow } from '../../test/task-fixtures';
import { TaskInterestControls } from './TaskInterestControls';

describe('Withdraw and rejoin', () => {
  it('explains the queued stage when controls are available', () => {
    render(
      <TaskInterestControls
        taskId={1}
        task={toTaskPresentation(taskRow(), new Date('2026-09-01'))}
      />,
    );
    expect(
      screen.getByText('Ești pe locul 2 în lista de așteptare.'),
    ).toBeVisible();
  });
  beforeEach(() => {
    hooks.useTaskQueue.mockReturnValue({
      data: { status: 'pending', position: 2 },
    });
    hooks.useExpressTaskInterest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ kind: 'queued', position: 7 }),
    });
    hooks.useWithdrawTaskInterest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    });
  });
  it('withdraws without a reason, then reports the new server position on rejoin', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TaskInterestControls taskId={1} />);
    await user.click(
      screen.getByRole('button', { name: 'Retrage înscrierea' }),
    );
    expect(hooks.useWithdrawTaskInterest().mutateAsync).toHaveBeenCalledWith(1);
    hooks.useTaskQueue.mockReturnValue({
      data: { status: 'withdrawn', position: null },
    });
    rerender(<TaskInterestControls taskId={1} />);
    await user.click(
      screen.getByRole('button', { name: 'Înscrie-te din nou' }),
    );
    expect(
      screen.getByText('Te-ai înscris pe locul 7 în lista de așteptare.'),
    ).toBeVisible();
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
    render(<TaskInterestControls taskId={1} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toBeDisabled();
    await user.click(screen.getByRole('button'));
    expect(mutateAsync).toHaveBeenCalledOnce();
    reject(new Error('Taskul s-a schimbat.'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Taskul s-a schimbat.',
    );
    expect(screen.getByText('Locul 2 în lista de așteptare')).toBeVisible();
  });
});
