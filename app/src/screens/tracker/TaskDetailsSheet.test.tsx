import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
const useTaskDetails = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-details', () => ({ useTaskDetails }));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/task-queue', () => ({ useTaskQueue: vi.fn() }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member' } } }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));
vi.mock('./TaskHistory', () => ({
  TaskHistory: () => <p>Istoric autorizat</p>,
}));
import { TaskDetailsSheet } from './TaskDetailsSheet';
import { taskRow } from '../../test/task-fixtures';

describe('Task details sheet', () => {
  it('shows authorized fields, hides unknown Executor identity and closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    useTaskDetails.mockReturnValue({
      data: {
        task: taskRow({ review_round: 2, duplicated_from_task_id: 7 }),
        executorName: null,
        subtasks: [],
      },
    });
    const { container } = render(
      <TaskDetailsSheet taskId={1} onClose={onClose} />,
    );
    expect(
      await screen.findByRole('dialog', { name: 'Detalii task' }),
    ).toBeVisible();
    expect(screen.getByText('În cadrul originii')).toBeVisible();
    expect(screen.getByText('Indisponibil')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Duplicat din #7' }),
    ).toBeVisible();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('does not distinguish a hidden Task from a missing Task', async () => {
    useTaskDetails.mockReturnValue({ data: null });
    render(<TaskDetailsSheet taskId={1} onClose={vi.fn()} />);
    expect(await screen.findByText('Taskul nu este disponibil.')).toBeVisible();
  });
});
