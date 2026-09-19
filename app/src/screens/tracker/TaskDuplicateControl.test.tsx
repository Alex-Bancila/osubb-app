import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const duplicate = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-duplication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/task-duplication')>()),
  useDuplicateTask: () => ({ mutateAsync: duplicate }),
}));
import { TaskDuplicateControl } from './TaskDuplicateControl';

describe('Duplicate task', () => {
  it('requires a real Bucharest instant before calling the command', async () => {
    const user = userEvent.setup();
    render(<TaskDuplicateControl taskId={1} onDuplicated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Duplică' }));
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Alege un termen-limită valid',
    );
    fireEvent.change(screen.getByLabelText('Termen nou (ora Bucureștiului)'), {
      target: { value: '2026-03-29T03:30' },
    });
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(duplicate).not.toHaveBeenCalled();
  });
  it('prevents duplicate submits, preserves the date on safe failure and retries', async () => {
    let rejectCommand: (error: unknown) => void = () => undefined;
    duplicate.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCommand = reject;
        }),
    );
    const navigate = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <TaskDuplicateControl taskId={1} onDuplicated={navigate} />,
    );
    await user.click(screen.getByRole('button', { name: 'Duplică' }));
    const date = screen.getByLabelText('Termen nou (ora Bucureștiului)');
    fireEvent.change(date, { target: { value: '2026-12-20T12:30' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Duplică taskul' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Duplică taskul' }));
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Creează copia' }),
    ).toBeDisabled();
    await act(async () =>
      rejectCommand({ code: '42501', message: 'private internal query' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Nu ai permisiunea');
    expect(screen.queryByText(/private internal/)).not.toBeInTheDocument();
    expect(date).toHaveValue('2026-12-20T12:30');
    expect(navigate).not.toHaveBeenCalled();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    duplicate.mockResolvedValueOnce({ id: 8 });
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(navigate).toHaveBeenCalledWith(8);
  });
});
