import { render, screen, within } from '@testing-library/react';
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
it('reopens a closed queue in one click', async () => {
  const { container } = render(<TaskQueueControl taskId={17} closed />);
  await userEvent.click(screen.getByRole('button', { name: 'Deschide coada' }));
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ taskId: 17, open: true });
  expect((await axe.run(container)).violations).toEqual([]);
});
it('asks for confirmation before closing an open queue', async () => {
  render(<TaskQueueControl taskId={17} closed={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Închide coada' }));
  expect(mutate).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog', { name: 'Închizi coada?' });
  expect(dialog).toHaveTextContent('trebuie să se înscrie din nou');
  expect((await axe.run(dialog)).violations).toEqual([]);
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Renunță' }),
  );
  expect(mutate).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Închide coada' }));
  const confirm = await screen.findByRole('dialog', { name: 'Închizi coada?' });
  await userEvent.click(
    within(confirm).getByRole('button', { name: 'Închide coada' }),
  );
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ taskId: 17, open: false });
});
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
