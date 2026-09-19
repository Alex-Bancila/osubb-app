import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const hook = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-queue-control', () => ({ useSetTaskQueue: hook }));
import { TaskQueueControl } from './TaskQueueControl';
const mutate = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  hook.mockReturnValue({ mutate, isPending: false });
});
it.each([true, false])(
  'offers the opposite state when closed=%s',
  async (closed) => {
    const { container } = render(
      <TaskQueueControl taskId={17} closed={closed} />,
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: closed ? 'Deschide coada' : 'Închide coada',
      }),
    );
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      taskId: 17,
      open: closed,
    });
    expect((await axe.run(container)).violations).toEqual([]);
  },
);
it('prevents repeat submissions while pending', () => {
  hook.mockReturnValue({ mutate, isPending: true });
  render(<TaskQueueControl taskId={17} closed={false} />);
  expect(screen.getByRole('button')).toBeDisabled();
});
it.each([
  'Coada s-a schimbat. Datele au fost actualizate.',
  'Nu ai permisiunea să modifici coada acestui task.',
])('announces command failure: %s', (message) => {
  hook.mockReturnValue({ mutate, isError: true, error: new Error(message) });
  render(<TaskQueueControl taskId={17} closed={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent(message);
});
