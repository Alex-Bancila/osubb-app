import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * What a `Select` offers, read the way a member sees it: open the field,
 * take each option's text and whether it can be chosen, and close it again.
 */
export async function optionsOf(user: UserEvent, field: HTMLElement) {
  await user.click(field);
  const options = (await screen.findAllByRole('option')).map((option) => ({
    text: option.textContent,
    disabled: option.getAttribute('aria-disabled') === 'true',
  }));
  await user.keyboard('{Escape}');
  return options;
}

/** The names of the options of a `Select`, in order. */
export async function optionNames(user: UserEvent, field: HTMLElement) {
  return (await optionsOf(user, field)).map((option) => option.text);
}
