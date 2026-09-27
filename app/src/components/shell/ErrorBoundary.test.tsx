import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Crash(): never {
  throw new Error('secret internal detail');
}

beforeEach(() => {
  // React reports a caught render error on the console; keep the run quiet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it('renders its children while nothing fails', () => {
  render(
    <ErrorBoundary>
      <p>Conținut</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText('Conținut')).toBeVisible();
});

it('replaces a crashed tree with a plain Romanian message and no details in production', () => {
  vi.stubEnv('DEV', false);
  render(
    <ErrorBoundary>
      <Crash />
    </ErrorBoundary>,
  );

  expect(
    screen.getByRole('heading', { name: 'Ceva nu a funcționat' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Reîncarcă pagina' }),
  ).toBeVisible();
  expect(screen.queryByText(/secret internal detail/)).toBeNull();
  expect(screen.queryByTestId('error-details')).toBeNull();
});

it('shows the error itself in development', () => {
  vi.stubEnv('DEV', true);
  render(
    <ErrorBoundary>
      <Crash />
    </ErrorBoundary>,
  );

  expect(screen.getByTestId('error-details')).toHaveTextContent(
    'secret internal detail',
  );
});
