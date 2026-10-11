import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { clearDate, pickDate } from '../../test/date-picker';
import { DatePicker, DateTimePicker, formatPickerValue } from './date-picker';

function Field({
  initial = '',
  withTime = true,
  required = false,
  min,
  onChange = () => {},
}: {
  initial?: string;
  withTime?: boolean;
  required?: boolean;
  min?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const Picker = withTime ? DateTimePicker : DatePicker;
  return (
    <>
      <label htmlFor="termen">Termen</label>
      <Picker
        id="termen"
        value={value}
        required={required}
        min={min}
        defaultTime="23:59"
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
}

describe('formatPickerValue', () => {
  it('reads as the cards do, in Romanian, on a 24-hour clock', () => {
    expect(formatPickerValue('2026-10-14T23:59')).toBe(
      'mie., 14 oct. 2026 · 23:59',
    );
    expect(formatPickerValue('2026-10-14')).toBe('mie., 14 oct. 2026');
    expect(formatPickerValue('')).toBeNull();
    expect(formatPickerValue('2026-02-31')).toBeNull();
  });
});

describe('DateTimePicker', () => {
  it('is a field named by its label that shows the value, or says what to choose', () => {
    const { unmount } = render(<Field initial="2026-10-14T23:59" />);
    expect(screen.getByLabelText('Termen')).toHaveTextContent(
      'mie., 14 oct. 2026 · 23:59',
    );
    unmount();
    render(<Field />);
    expect(screen.getByLabelText('Termen')).toHaveTextContent(
      'Alege data și ora',
    );
  });

  it('chooses a day in another month and a time, as the native field’s string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field initial="2026-10-14T23:59" onChange={onChange} />);

    await pickDate(user, screen.getByLabelText('Termen'), '2026-12-03T18:30');

    expect(onChange).toHaveBeenLastCalledWith('2026-12-03T18:30');
    expect(screen.getByLabelText('Termen')).toHaveTextContent(
      'joi, 3 dec. 2026 · 18:30',
    );
  });

  it('starts a newly chosen day at the default time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field initial="" onChange={onChange} />);

    await user.click(screen.getByLabelText('Termen'));
    await user.click(await screen.findByRole('button', { name: 'Mâine' }));
    expect(onChange.mock.lastCall?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T23:59$/);
  });

  it('opens on the value’s month with Monday first and the chosen day pressed', async () => {
    const user = userEvent.setup();
    render(<Field initial="2026-10-14T23:59" />);

    await user.click(screen.getByLabelText('Termen'));
    const popup = await screen.findByRole('dialog', {
      name: 'Alege data și ora',
    });
    expect(within(popup).getByText('Octombrie 2026')).toBeVisible();
    const grid = popup.querySelector<HTMLElement>(
      '[data-slot="date-picker-grid"]',
    );
    // 28 September 2026 is the Monday that opens October's grid.
    expect(grid?.querySelector('button')).toHaveAttribute(
      'data-day',
      '2026-09-28',
    );
    expect(
      within(popup).getByRole('button', {
        name: 'miercuri, 14 octombrie 2026',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves through the days with the arrow keys and the months with Page Down', async () => {
    const user = userEvent.setup();
    render(<Field initial="2026-10-14T23:59" />);

    await user.click(screen.getByLabelText('Termen'));
    const chosen = await screen.findByRole('button', {
      name: 'miercuri, 14 octombrie 2026',
    });
    chosen.focus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('button', { name: 'joi, 15 octombrie 2026' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('button', { name: 'joi, 22 octombrie 2026' }),
    ).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(screen.getByText('Noiembrie 2026')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'duminică, 1 noiembrie 2026' }),
    ).toHaveFocus();
  });

  it('refuses a day before `min`', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field initial="2026-10-14T23:59" min="2026-10-10" onChange={onChange} />,
    );

    await user.click(screen.getByLabelText('Termen'));
    expect(
      await screen.findByRole('button', { name: 'vineri, 9 octombrie 2026' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'sâmbătă, 10 octombrie 2026' }),
    ).toBeEnabled();
  });

  it('clears an optional value, and offers no Șterge on a required one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(
      <Field initial="2026-10-14T23:59" onChange={onChange} />,
    );
    await clearDate(user, screen.getByLabelText('Termen'));
    expect(onChange).toHaveBeenLastCalledWith('');
    unmount();

    render(<Field initial="2026-10-14T23:59" required />);
    await user.click(screen.getByLabelText('Termen'));
    await screen.findByRole('dialog', { name: 'Alege data și ora' });
    expect(screen.queryByRole('button', { name: 'Șterge' })).toBeNull();
    // A button takes no `aria-required`; the form validates the field.
    expect(screen.getByLabelText('Termen')).not.toHaveAttribute(
      'aria-required',
    );
  });
});

describe('DatePicker', () => {
  it('chooses a day alone and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field withTime={false} initial="2026-10-14" onChange={onChange} />);

    await pickDate(user, screen.getByLabelText('Termen'), '2026-10-20');

    expect(onChange).toHaveBeenLastCalledWith('2026-10-20');
    expect(screen.queryByLabelText('Ora')).toBeNull();
    expect(screen.getByLabelText('Termen')).toHaveTextContent(
      'mar., 20 oct. 2026',
    );
  });
});

it('is always its full height: nothing scrolls inside the popup (spec 2026-10-11, Part D)', async () => {
  const user = userEvent.setup();
  render(<Field />);
  await user.click(screen.getByLabelText('Termen'));
  const popup = await screen.findByRole('dialog', {
    name: 'Alege data și ora',
  });
  expect(popup.className).not.toMatch(
    /max-h-|overflow-y-auto|overscroll-contain/,
  );
});
