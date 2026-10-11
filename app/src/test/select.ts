import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Choose an option in a `Select` the way a member does: open it from its
 * field and press the option by its name. The field's current value is its
 * text, or `field.dataset.value`.
 */
export async function chooseOption(
  user: UserEvent,
  field: HTMLElement,
  name: string | RegExp,
) {
  await user.click(field);
  await user.click(await screen.findByRole('option', { name }));
}

/** The names a `Select` offers, read by opening it and closing it again. */
export async function optionNames(user: UserEvent, field: HTMLElement) {
  await user.click(field);
  const names = (await screen.findAllByRole('option')).map(
    (option) => option.textContent,
  );
  await user.keyboard('{Escape}');
  return names;
}
