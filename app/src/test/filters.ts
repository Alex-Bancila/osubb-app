import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** The page's **Filtrează** button (#903), whatever its count. */
export function filterButton() {
  return screen.getByRole('button', { name: /^Filtrează/ });
}

/** Opens the filter sheet from **Filtrează** and returns it. */
export async function openFilters(user: UserEvent) {
  await user.click(filterButton());
  return screen.getByRole('dialog', { name: 'Filtre' });
}

/** Closes the filter sheet with **Vezi rezultatele**. */
export async function closeFilters(user: UserEvent) {
  await user.click(
    within(screen.getByRole('dialog', { name: 'Filtre' })).getByRole('button', {
      name: 'Vezi rezultatele',
    }),
  );
}
