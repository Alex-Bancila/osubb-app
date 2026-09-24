import * as axe from 'axe-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const scale = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  data: {
    ratings: [
      { rating: 1, multiplier: -1, label: 'Foarte slab' },
      { rating: 2, multiplier: 0, label: 'Insuficient' },
      { rating: 3, multiplier: 1, label: 'Bun' },
      { rating: 4, multiplier: 2, label: 'Foarte bun' },
      { rating: 5, multiplier: 3, label: 'Excelent' },
    ],
    difficulties: [
      { stars: 1, note: 'Foarte ușor' },
      { stars: 2, note: 'Ușor' },
      { stars: 3, note: 'Mediu' },
      { stars: 4, note: 'Greu' },
      { stars: 5, note: 'Foarte greu' },
    ],
  },
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => scale,
}));
import { EvaluationFields } from './EvaluationFields';

const onEvaluate = vi.fn();
beforeEach(() => {
  onEvaluate.mockReset().mockResolvedValue(undefined);
});

function renderForm() {
  return render(
    <EvaluationFields
      executorName="Ana"
      onCancel={vi.fn()}
      onSuccess={vi.fn()}
      onEvaluate={onEvaluate}
      isPending={false}
    />,
  );
}

it('offers Rating as five named stars and Difficulty as five named steps', () => {
  renderForm();
  const rating = screen.getByRole('radiogroup', {
    name: 'Calificativ (obligatoriu)',
  });
  expect(
    within(rating)
      .getAllByRole('radio')
      .map((star) => star.getAttribute('aria-label')),
  ).toEqual([
    '1 — Nelivrat / inacceptabil',
    '2 — Sub așteptări',
    '3 — Conform așteptărilor',
    '4 — Peste așteptări',
    '5 — Excepțional',
  ]);
  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  expect(
    within(difficulty)
      .getAllByRole('radio')
      .map((step) => step.getAttribute('aria-label')),
  ).toEqual([
    '1 — Foarte ușor',
    '2 — Ușor',
    '3 — Mediu',
    '4 — Greu',
    '5 — Foarte greu',
  ]);
});

it('moves the choice with the arrow keys and shows the chosen hint', async () => {
  const user = userEvent.setup();
  renderForm();
  const rating = screen.getByRole('radiogroup', {
    name: 'Calificativ (obligatoriu)',
  });
  await user.click(
    screen.getByRole('radio', { name: '3 — Conform așteptărilor' }),
  );
  expect(rating).toHaveAccessibleDescription('3 — Conform așteptărilor');
  await user.keyboard('{ArrowRight}');
  expect(
    screen.getByRole('radio', { name: '4 — Peste așteptări' }),
  ).toBeChecked();
  expect(
    screen.getByRole('radio', { name: '4 — Peste așteptări' }),
  ).toHaveFocus();
  expect(rating).toHaveAccessibleDescription('4 — Peste așteptări');

  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  await user.click(screen.getByRole('radio', { name: '2 — Ușor' }));
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: '1 — Foarte ușor' })).toBeChecked();
  expect(difficulty).toHaveAccessibleDescription('1 — Foarte ușor');
});

it('keeps the points preview and sends the same integers to the command', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole('radio', { name: '4 — Greu' }));
  await user.click(screen.getByRole('radio', { name: '5 — Excepțional' }));
  // Difficulty × the Rating's multiplier from `rating_guide`: 4 × 3.
  expect(screen.getByRole('status')).toHaveTextContent('12 puncte');
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Foarte bine');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(onEvaluate).toHaveBeenCalledWith({
    difficulty: 4,
    rating: 5,
    note: 'Foarte bine',
  });
});

it('refuses a missing choice under its control and focuses it', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(onEvaluate).not.toHaveBeenCalled();
  expect(
    screen.getByText('Alege o Dificultate între 1 și 5.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Alege un Calificativ între 1 și 5.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('radiogroup', { name: 'Dificultate (obligatoriu)' }),
  ).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('radio', { name: '1 — Foarte ușor' })).toHaveFocus();
});

it('passes automated accessibility checks with a choice made', async () => {
  const user = userEvent.setup();
  const { container } = renderForm();
  await user.click(screen.getByRole('radio', { name: '3 — Mediu' }));
  await user.click(screen.getByRole('radio', { name: '2 — Sub așteptări' }));
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
