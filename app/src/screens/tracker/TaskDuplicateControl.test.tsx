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
import { pickDate } from '../../test/date-picker';
import { TaskDuplicateControl } from './TaskDuplicateControl';
// Each case pages the date picker month by month; on a loaded machine that
// can pass the 5 s default without anything being wrong.
vi.setConfig({ testTimeout: 15_000 });

describe('Duplicate task', () => {
  it('requires a real Bucharest instant before calling the command', async () => {
    const user = userEvent.setup();
    render(<TaskDuplicateControl taskId={1} onDuplicated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Duplică' }));
    // A form sheet with no intro paragraph: what the copy keeps is behind
    // the field's "i", still the field's description.
    const sheet = await screen.findByRole('dialog', { name: 'Duplică taskul' });
    expect(sheet).toHaveAttribute('data-slot', 'form-sheet');
    const date = screen.getByLabelText('Termen nou — ora României');
    expect(date).toHaveAttribute('data-slot', 'date-picker');
    expect(date).toHaveAccessibleDescription(
      /Executorul și rezultatele nu se copiază/,
    );
    expect(
      screen.getByText(/Executorul și rezultatele nu se copiază/),
    ).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    // The rule is shown under the field, which takes focus (ruling R8).
    expect(date).toHaveAccessibleDescription(
      expect.stringContaining('Alege termenul taskului.'),
    );
    expect(date).toHaveFocus();
    await pickDate(user, date, '2026-03-29T03:30');
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(date).toHaveAccessibleDescription(
      expect.stringContaining('Alege un termen valid, în ora României.'),
    );
    // duplicate_task refuses a deadline in the past; so does the sheet.
    await pickDate(user, date, '2026-01-10T12:30');
    await user.click(screen.getByRole('button', { name: 'Creează copia' }));
    expect(date).toHaveAccessibleDescription(
      expect.stringContaining('Termenul nu poate fi în trecut.'),
    );
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
    const date = screen.getByLabelText('Termen nou — ora României');
    await pickDate(user, date, '2030-12-20T12:30');
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
    expect(date).toHaveAttribute('data-value', '2030-12-20T12:30');
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
