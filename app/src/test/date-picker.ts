import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Choose a value in a `DatePicker` / `DateTimePicker` the way a member does:
 * open it from its field, page to the month, press the day and — when the
 * value carries a time — type the time and press **Gata**. `value` is the
 * wall-clock string the field holds: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`.
 */
export async function pickDate(
  user: UserEvent,
  field: HTMLElement,
  value: string,
) {
  await user.click(field);
  const grid = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(
      '[data-slot="date-picker-grid"]',
    );
    if (!found) throw new Error('The date picker did not open.');
    return found;
  });
  const month = value.slice(0, 7);
  for (let guard = 0; guard < 240 && grid.dataset.month !== month; guard++) {
    await user.click(
      screen.getByRole('button', {
        name:
          (grid.dataset.month ?? '') < month
            ? 'Luna următoare'
            : 'Luna anterioară',
      }),
    );
  }
  const day = grid.querySelector<HTMLElement>(
    `[data-day="${value.slice(0, 10)}"]`,
  );
  if (!day) throw new Error(`No day ${value.slice(0, 10)} in the picker.`);
  await user.click(day);
  if (value.length > 10) {
    const time = screen.getByLabelText('Ora');
    await user.clear(time);
    await user.type(time, value.slice(11, 16));
    await user.click(screen.getByRole('button', { name: 'Gata' }));
  }
  await waitFor(() => {
    if (document.querySelector('[data-slot="date-picker-grid"]'))
      throw new Error('The date picker did not close.');
  });
}

/** Clear a picker that is not required, with its **Șterge** button. */
export async function clearDate(user: UserEvent, field: HTMLElement) {
  await user.click(field);
  await user.click(await screen.findByRole('button', { name: 'Șterge' }));
}
