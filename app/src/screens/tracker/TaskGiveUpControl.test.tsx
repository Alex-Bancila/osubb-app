import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => mutation,
}));

import { TaskGiveUpControl } from './TaskGiveUpControl';

describe('Task give-up control', () => {
  beforeEach(() => {
    mutation.isPending = false;
    mutation.mutateAsync.mockReset().mockResolvedValue({ id: 17 });
  });

  it('requires a reason and never calls the command for whitespace', async () => {
    const user = userEvent.setup();
    render(<TaskGiveUpControl taskId={17} />);

    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    await user.type(screen.getByLabelText('Motivul renunțării'), '   ');
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Scrie motivul');
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('submits the reason, reports success and closes the form', async () => {
    const user = userEvent.setup();
    render(<TaskGiveUpControl taskId={17} />);

    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    await user.type(
      screen.getByLabelText('Motivul renunțării'),
      'Nu mai pot participa',
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );

    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      taskId: 17,
      reason: 'Nu mai pot participa',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ai renunțat la task',
    );
    expect(
      screen.queryByLabelText('Motivul renunțării'),
    ).not.toBeInTheDocument();
  });

  it('preserves the reason and shows a safe command failure', async () => {
    const user = userEvent.setup();
    mutation.mutateAsync.mockRejectedValue(new Error('Taskul s-a schimbat.'));
    render(<TaskGiveUpControl taskId={17} />);

    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    const reason = screen.getByLabelText('Motivul renunțării');
    await user.type(reason, 'Program schimbat');
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Taskul s-a schimbat.',
    );
    expect(reason).toHaveValue('Program schimbat');
  });

  it('is keyboard accessible', async () => {
    const user = userEvent.setup();
    const { container } = render(<TaskGiveUpControl taskId={17} />);

    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Renunță la task' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Motivul renunțării')).toBeVisible();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
