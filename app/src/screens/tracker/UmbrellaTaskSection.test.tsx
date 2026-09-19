import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { taskRow } from '../../test/task-fixtures';
const complete = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-umbrella', () => ({
  useCompleteUmbrella: () => ({ mutateAsync: complete }),
  useCreateSubtask: () => ({ mutateAsync: create, isPending: false }),
}));
vi.mock('./ManagedTaskForm', () => ({
  ManagedTaskForm: ({
    parentTaskId,
    onDraft,
  }: {
    parentTaskId: number;
    onDraft: (draft: object) => void;
  }) => (
    <button onClick={() => onDraft({ parentTaskId, title: 'Copil nou' })}>
      Trimite subtask pentru #{parentTaskId}
    </button>
  ),
}));
import { UmbrellaTaskSection } from './UmbrellaTaskSection';
const common = {
  taskId: 10,
  status: 'todo' as const,
  canManage: true,
  onNavigate: vi.fn(),
};

describe('Umbrella progress and actions', () => {
  it('updates terminal progress and button eligibility with live child states', async () => {
    const rows = [
      taskRow({ id: 1, status: 'completed' }),
      taskRow({ id: 2, status: 'in_review' }),
    ];
    const { rerender, container } = render(
      <UmbrellaTaskSection {...common} subtasks={rows} />,
    );
    expect(screen.getByText('1 / 2 finalizate')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    ).toBeDisabled();
    expect(screen.getByText(/Toate subtaskurile trebuie/)).toBeVisible();
    rerender(
      <UmbrellaTaskSection
        {...common}
        subtasks={[
          ...rows.slice(0, 1),
          taskRow({ id: 2, status: 'cancelled' }),
          taskRow({ id: 3, status: 'unfulfilled' }),
        ]}
      />,
    );
    expect(screen.getByText('3 / 3 finalizate')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    ).toBeEnabled();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
  it('disables empty completion and hides actions for members and terminal Umbrellas', () => {
    const { rerender } = render(
      <UmbrellaTaskSection {...common} subtasks={[]} />,
    );
    expect(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    ).toBeDisabled();
    expect(screen.getByText(/cel puțin un subtask/)).toBeVisible();
    rerender(
      <UmbrellaTaskSection {...common} canManage={false} subtasks={[]} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <UmbrellaTaskSection {...common} status="completed" subtasks={[]} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps the completion receipt when refetch renders the final state before mutation resolution', async () => {
    let resolve: (task: object) => void = () => undefined;
    complete.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    const rows = [taskRow({ status: 'completed' })];
    const { rerender } = render(
      <UmbrellaTaskSection {...common} subtasks={rows} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    );
    expect(complete).toHaveBeenCalledWith(10);
    expect(
      screen.getByRole('button', { name: 'Se finalizează…' }),
    ).toBeDisabled();
    rerender(
      <UmbrellaTaskSection {...common} status="completed" subtasks={rows} />,
    );
    await act(async () => resolve({ id: 10 }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Taskul-umbrelă a fost finalizat.',
    );
    expect(
      screen.queryByRole('button', { name: 'Finalizează umbrela' }),
    ).not.toBeInTheDocument();
  });
  it('shows safe conflicts and allows retry after the list changes', async () => {
    complete
      .mockRejectedValueOnce({ code: 'PT409', message: 'private internals' })
      .mockResolvedValueOnce({ id: 10 });
    const user = userEvent.setup();
    render(
      <UmbrellaTaskSection
        {...common}
        subtasks={[taskRow({ status: 'completed' })]}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Starea subtaskurilor s-a schimbat',
    );
    expect(screen.queryByText(/private internals/)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Finalizează umbrela' }),
    );
    expect(screen.getByRole('status')).toBeVisible();
  });
  it('passes the fixed parent to the shared form, creates and opens the child', async () => {
    create.mockResolvedValueOnce({ id: 27 });
    const user = userEvent.setup();
    render(<UmbrellaTaskSection {...common} subtasks={[]} />);
    await user.click(screen.getByRole('button', { name: 'Adaugă subtask' }));
    await user.click(
      screen.getByRole('button', { name: 'Trimite subtask pentru #10' }),
    );
    expect(create).toHaveBeenCalledWith({
      parentTaskId: 10,
      title: 'Copil nou',
    });
    expect(common.onNavigate).toHaveBeenCalledWith(27);
  });
});
