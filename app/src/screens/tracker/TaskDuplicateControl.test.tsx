import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
    const date = screen.getByLabelText('Termen nou (ora Bucureștiului)');
    // The rule is shown under the field, which takes focus (ruling R8).
    expect(date).toHaveAccessibleDescription('Alege termenul taskului.');
    expect(date).toHaveFocus();
    fireEvent.change(date, { target: { value: '2026-03-29T03:30' } });
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(date).toHaveAccessibleDescription(
      'Alege un termen valid, în ora României.',
    );
    // duplicate_task refuses a deadline in the past; so does the pop-up.
    fireEvent.change(date, { target: { value: '2020-01-10T12:30' } });
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(date).toHaveAccessibleDescription('Termenul nu poate fi în trecut.');
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
    render(<TaskDuplicateControl taskId={1} onDuplicated={navigate} />);
    await user.click(screen.getByRole('button', { name: 'Duplică' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Duplică taskul',
    });
    const date = screen.getByLabelText('Termen nou (ora Bucureștiului)');
    fireEvent.change(date, { target: { value: '2030-12-20T12:30' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Duplică taskul' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Duplică taskul' }));
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Creează copia' }),
    ).toBeDisabled();
    await act(async () =>
      rejectCommand({
        code: '42501',
        message: 'task_manage_forbidden',
        details: 'private internal query',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea',
    );
    expect(screen.queryByText(/private internal/)).not.toBeInTheDocument();
    expect(date).toHaveValue('2030-12-20T12:30');
    expect(navigate).not.toHaveBeenCalled();
    expect(
      (
        await axe.run(dialog, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    duplicate.mockResolvedValueOnce({ id: 8 });
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(navigate).toHaveBeenCalledWith(8);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
