import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RouteLoader } from './RouteLoader';

it('holds the place of a page whose code is on its way: a title and rows, said to a screen reader', () => {
  const { container } = render(<RouteLoader />);
  expect(screen.getByRole('status')).toHaveTextContent('Se încarcă pagina');
  // The page's shape, not a spinner: a heading bar above the rows.
  expect(
    container.querySelector('[data-slot="skeleton-heading"]'),
  ).not.toBeNull();
  expect(
    container.querySelectorAll('[data-slot="skeleton"]').length,
  ).toBeGreaterThanOrEqual(3);
  expect(container.querySelector('.animate-spin')).toBeNull();
});
