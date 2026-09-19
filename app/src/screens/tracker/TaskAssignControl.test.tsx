import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import * as axe from 'axe-core';
const mutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../../queries/task-assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/task-assignment')>()),
  useTaskAssignment: () => mutation,
}));
vi.mock('./DirectExecutorSelector', () => ({
  DirectExecutorSelector: ({
    onChange,
  }: {
    onChange: (id: string) => void;
  }) => (
    <button type="button" onClick={() => onChange('member')}>
      Alege Ana
    </button>
  ),
}));
import { TaskAssignControl } from './TaskAssignControl';
const props = {
  taskId: 7,
  groupId: 3,
  status: 'todo' as const,
  kind: 'task',
  assignmentMode: 'direct',
  hasExecutor: false,
  canManage: true,
};
beforeEach(() => {
  mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  mutation.isPending = false;
});
it.each([
  { assignmentMode: 'public' },
  { hasExecutor: true },
  { canManage: false },
  { kind: 'umbrella' },
  { status: 'completed' as const },
  { status: 'unfulfilled' as const },
  { status: 'cancelled' as const },
])('hides assignment for %o', (overrides) => {
  render(<TaskAssignControl {...props} {...overrides} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('requires selection and sends a single command, keeps confirmation after refetch', async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  mutation.mutateAsync.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const view = render(<TaskAssignControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Atribuie' }));
  expect(
    screen.getByRole('button', { name: 'Confirmă atribuirea' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Alege Ana' }));
  await user.dblClick(
    screen.getByRole('button', { name: 'Confirmă atribuirea' }),
  );
  expect(mutation.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    taskId: 7,
    memberId: 'member',
  });
  view.rerender(<TaskAssignControl {...props} hasExecutor />);
  resolve();
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Executorul a fost atribuit.',
    ),
  );
  expect(screen.getByRole('status')).toHaveFocus();
  view.rerender(<TaskAssignControl {...props} />);
  expect(screen.getByRole('button', { name: 'Atribuie' })).toBeVisible();
});
it('keeps a safe retry after command failure and passes axe', async () => {
  const user = userEvent.setup();
  mutation.mutateAsync.mockRejectedValue(new Error('private backend trace'));
  const { container } = render(<TaskAssignControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Atribuie' }));
  await user.click(screen.getByRole('button', { name: 'Alege Ana' }));
  await user.click(screen.getByRole('button', { name: 'Confirmă atribuirea' }));
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'private backend trace',
  );
  expect(
    screen.getByRole('button', { name: 'Confirmă atribuirea' }),
  ).toBeEnabled();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
