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

const nota = () =>
  screen.getByRole('spinbutton', { name: 'Nota (obligatoriu)' });

it('offers Difficulty as five named stars and Nota as one number (R29a)', () => {
  renderForm();
  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  expect(
    within(difficulty)
      .getAllByRole('radio')
      .map((star) => star.getAttribute('aria-label')),
  ).toEqual([
    '1 stea — Foarte ușor',
    '2 stele — Ușor',
    '3 stele — Mediu',
    '4 stele — Greu',
    '5 stele — Foarte greu',
  ]);
  expect(nota()).toHaveAttribute('aria-valuemin', '1');
  expect(nota()).toHaveAttribute('aria-valuemax', '5');
  expect(nota()).not.toHaveAttribute('aria-valuenow');
  expect(nota()).toHaveAttribute('aria-valuetext', 'Nealeasă');
  // Nota is a number, not a scale of radios.
  expect(
    screen.queryByRole('radiogroup', { name: /Nota/ }),
  ).not.toBeInTheDocument();
});

it('sets the stars with the arrow keys and the number keys', async () => {
  const user = userEvent.setup();
  renderForm();
  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  await user.click(screen.getByRole('radio', { name: '2 stele — Ușor' }));
  expect(difficulty).toHaveAccessibleDescription('2 din 5 — Ușor');
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: '3 stele — Mediu' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '3 stele — Mediu' })).toHaveFocus();
  await user.keyboard('5');
  const five = screen.getByRole('radio', { name: '5 stele — Foarte greu' });
  expect(five).toBeChecked();
  expect(five).toHaveFocus();
  expect(difficulty).toHaveAccessibleDescription('5 din 5 — Foarte greu');
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: '4 stele — Greu' })).toBeChecked();
  // Keys outside 1–5 choose nothing.
  await user.keyboard('0');
  expect(screen.getByRole('radio', { name: '4 stele — Greu' })).toBeChecked();
});

it('steps Nota with the keyboard and the buttons, only within 1–5', async () => {
  const user = userEvent.setup();
  renderForm();
  // Nothing is chosen for the evaluator: the first step up is 1.
  await user.click(screen.getByRole('button', { name: 'Crește nota' }));
  expect(nota()).toHaveAttribute('aria-valuenow', '1');
  expect(nota()).toHaveAccessibleDescription(
    '1 din 5 — Nelivrat / inacceptabil',
  );
  expect(screen.getByRole('button', { name: 'Scade nota' })).toBeDisabled();
  await user.click(nota());
  await user.keyboard('{ArrowUp}{ArrowRight}');
  expect(nota()).toHaveAttribute('aria-valuenow', '3');
  expect(nota()).toHaveAttribute('aria-valuetext', '3 — Conform așteptărilor');
  await user.keyboard('{End}{ArrowUp}');
  expect(nota()).toHaveAttribute('aria-valuenow', '5');
  expect(screen.getByRole('button', { name: 'Crește nota' })).toBeDisabled();
  await user.keyboard('{Home}{ArrowDown}');
  expect(nota()).toHaveAttribute('aria-valuenow', '1');
  await user.keyboard('4');
  expect(nota()).toHaveAttribute('aria-valuenow', '4');
  expect(nota()).toHaveTextContent('Nota4');
  await user.keyboard('9');
  expect(nota()).toHaveAttribute('aria-valuenow', '4');
});

it('keeps the points preview and sends the same integers to the command', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole('radio', { name: '4 stele — Greu' }));
  await user.click(nota());
  await user.keyboard('5');
  // Difficulty × the Rating's multiplier from `rating_guide`: 4 × 3.
  expect(screen.getByRole('status')).toHaveTextContent('12 puncte');
  await user.type(
    screen.getByLabelText('Observații (obligatoriu)'),
    'Foarte bine',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(onEvaluate).toHaveBeenCalledWith({
    difficulty: 4,
    rating: 5,
    note: 'Foarte bine',
  });
});

it.each([1, 2, 3, 4, 5])(
  'sends Difficulty %i and Nota %i as they were chosen',
  async (value) => {
    const user = userEvent.setup();
    renderForm();
    const star = screen.getAllByRole('radio')[value - 1];
    if (!star) throw new Error('Expected five stars');
    await user.click(star);
    await user.click(nota());
    await user.keyboard(String(value));
    await user.type(screen.getByLabelText('Observații (obligatoriu)'), 'ok');
    await user.click(
      screen.getByRole('button', { name: 'Confirmă evaluarea' }),
    );
    expect(onEvaluate).toHaveBeenCalledWith({
      difficulty: value,
      rating: value,
      note: 'ok',
    });
  },
);

it('refuses a missing choice under its control and focuses it', async () => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(onEvaluate).not.toHaveBeenCalled();
  expect(screen.getByText('Alege Dificultatea.')).toBeInTheDocument();
  expect(screen.getByText('Alege Nota.')).toBeInTheDocument();
  expect(
    screen.getByRole('radiogroup', { name: 'Dificultate (obligatoriu)' }),
  ).toHaveAttribute('aria-invalid', 'true');
  expect(nota()).toHaveAttribute('aria-invalid', 'true');
  expect(
    screen.getByRole('radio', { name: '1 stea — Foarte ușor' }),
  ).toHaveFocus();
});

it('keeps the Evaluation dialog layout (snapshot)', async () => {
  const user = userEvent.setup();
  const { container } = renderForm();
  await user.click(screen.getByRole('radio', { name: '3 stele — Mediu' }));
  await user.click(nota());
  await user.keyboard('4');
  expect(container.firstChild).toMatchSnapshot();
});

it('passes automated accessibility checks with a choice made', async () => {
  const user = userEvent.setup();
  const { container } = renderForm();
  await user.click(screen.getByRole('radio', { name: '3 stele — Mediu' }));
  await user.click(nota());
  await user.keyboard('2');
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
