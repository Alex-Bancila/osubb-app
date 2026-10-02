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
    // #985's ten levels and their base points.
    difficulties: [1, 2, 3, 4, 5, 6, 7, 8, 15, 20].map(
      (base_points, index) => ({
        level: index + 1,
        kind: index < 5 ? 'star' : index < 8 ? 'medal' : 'text',
        label: '',
        glyph: null,
        base_points,
      }),
    ),
  },
}));
const groups = vi.hoisted(() => ({ data: new Map() }));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => scale,
  useGroups: () => ({ data: groups.data, isPending: false }),
}));
import { EvaluationFields } from './EvaluationFields';
import { difficultyHint, ratingHint } from '../../screens/tracker/rating-guide';

const hint = (level: number) => difficultyHint(level) ?? '';
const ratingText = (value: number) => ratingHint(value) ?? '';

const onEvaluate = vi.fn();
beforeEach(() => {
  onEvaluate.mockReset().mockResolvedValue(undefined);
});

function renderForm(groupId: number | null = null) {
  return render(
    <EvaluationFields
      groupId={groupId}
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

it('offers Difficulty as ten named levels and Nota as one number (R29a, #986)', () => {
  renderForm();
  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  // Five stars, three medals, two roles — each named with the guide's words.
  expect(
    within(difficulty)
      .getAllByRole('radio')
      .map((option) => option.getAttribute('aria-label')),
  ).toEqual([
    `1 stea — ${hint(1)}`,
    `2 stele — ${hint(2)}`,
    `3 stele — ${hint(3)}`,
    `4 stele — ${hint(4)}`,
    `5 stele — ${hint(5)}`,
    `Bronz — ${hint(6)}`,
    `Argint — ${hint(7)}`,
    `Aur — ${hint(8)}`,
    `Responsabil — ${hint(9)}`,
    `Coordonator — ${hint(10)}`,
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
  await user.click(screen.getByRole('radio', { name: /^2 stele — / }));
  expect(difficulty).toHaveAccessibleDescription(`2 din 5 — ${hint(2)}`);
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: /^3 stele — / })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^3 stele — / })).toHaveFocus();
  await user.keyboard('5');
  const five = screen.getByRole('radio', { name: /^5 stele — / });
  expect(five).toBeChecked();
  expect(five).toHaveFocus();
  expect(difficulty).toHaveAccessibleDescription(`5 din 5 — ${hint(5)}`);
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: /^4 stele — / })).toBeChecked();
  // Keys outside 1–5 choose nothing.
  await user.keyboard('0');
  expect(screen.getByRole('radio', { name: /^4 stele — / })).toBeChecked();
});

it('steps Nota with the keyboard and the buttons, only within 1–5', async () => {
  const user = userEvent.setup();
  renderForm();
  // Nothing is chosen for the evaluator: the first step up is 1.
  await user.click(screen.getByRole('button', { name: 'Crește nota' }));
  expect(nota()).toHaveAttribute('aria-valuenow', '1');
  expect(nota()).toHaveAccessibleDescription(`1 din 5 — ${ratingText(1)}`);
  expect(screen.getByRole('button', { name: 'Scade nota' })).toBeDisabled();
  await user.click(nota());
  await user.keyboard('{ArrowUp}{ArrowRight}');
  expect(nota()).toHaveAttribute('aria-valuenow', '3');
  expect(nota()).toHaveAttribute('aria-valuetext', `3 — ${ratingText(3)}`);
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
  await user.click(screen.getByRole('radio', { name: /^4 stele — / }));
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
    if (!star) throw new Error('Expected ten levels');
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
  expect(screen.getByRole('radio', { name: /^1 stea — / })).toHaveFocus();
});

it('keeps the Evaluation dialog layout (snapshot)', async () => {
  const user = userEvent.setup();
  const { container } = renderForm();
  await user.click(screen.getByRole('radio', { name: /^3 stele — / }));
  await user.click(nota());
  await user.keyboard('4');
  expect(container.firstChild).toMatchSnapshot();
});

it('passes automated accessibility checks with a choice made', async () => {
  const user = userEvent.setup();
  const { container } = renderForm();
  await user.click(screen.getByRole('radio', { name: /^3 stele — / }));
  await user.click(nota());
  await user.keyboard('2');
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});

it('chooses a medal or a role and previews its base points (#985, #986)', async () => {
  const user = userEvent.setup();
  renderForm();
  const difficulty = screen.getByRole('radiogroup', {
    name: 'Dificultate (obligatoriu)',
  });
  // Arrow keys walk past the fifth star into the responsibilities.
  await user.click(screen.getByRole('radio', { name: /^5 stele — / }));
  await user.keyboard('{ArrowRight}');
  const bronz = screen.getByRole('radio', { name: /^Bronz — / });
  expect(bronz).toBeChecked();
  expect(bronz).toHaveFocus();
  expect(difficulty).toHaveAccessibleDescription(`🥉 Bronz — ${hint(6)}`);
  await user.click(screen.getByRole('radio', { name: /^Coordonator — / }));
  await user.click(nota());
  await user.keyboard('5');
  // Coordonator: 20 base points × the multiplier of Nota 5 (3).
  expect(screen.getByRole('status')).toHaveTextContent('60 puncte');
  await user.keyboard('1');
  expect(screen.getByRole('status')).toHaveTextContent('−20 puncte');
  await user.type(screen.getByLabelText('Observații (obligatoriu)'), 'ok');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(onEvaluate).toHaveBeenCalledWith({
    difficulty: 10,
    rating: 1,
    note: 'ok',
  });
});

const group = (
  id: number,
  name: string,
  short: string | null,
  category: string,
  path: number[],
  is_organization = false,
) => [id, { id, name, short, category, path, is_organization, color: null }];

it('sets Dificultate and Nota from the guide, which stays open until Gata (#986)', async () => {
  const user = userEvent.setup();
  groups.data = new Map([
    group(8, 'Educațional', 'EDU', 'department', [8]),
    group(58, 'Echipa Recruți', null, 'team', [8, 58]),
  ] as never);
  renderForm(58);
  await user.click(screen.getByRole('button', { name: 'Ghid de evaluare' }));
  const guide = await screen.findByRole('dialog', { name: 'Ghid de evaluare' });
  // A Child Group shows its Department's list.
  expect(guide).toHaveTextContent('Echipa Recruți· lista din Educațional');
  await user.click(
    within(guide).getByRole('button', {
      name: 'Setează Începător, Dificultate 3 stele — Voluntar contactări',
    }),
  );
  expect(within(guide).getByRole('status')).toHaveTextContent(
    'Setat în formular: Dificultate 3 stele.',
  );
  await user.click(
    within(guide).getByRole('button', { name: 'Note și dificultăți' }),
  );
  await user.click(
    within(guide).getByRole('button', { name: 'Setează Nota 4' }),
  );
  expect(
    within(guide).getByRole('button', { name: 'Setează Nota 4' }),
  ).toHaveAttribute('data-applied', 'true');
  await user.click(within(guide).getByRole('button', { name: 'Gata' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('radio', { name: /^3 stele — / })).toBeChecked();
  expect(nota()).toHaveAttribute('aria-valuenow', '4');
  // 3 base points × the multiplier of Nota 4 (2).
  expect(screen.getByRole('status')).toHaveTextContent('6 puncte');
  groups.data = new Map();
});

it('sets both values from an Interne row that fixes the Nota (#986)', async () => {
  const user = userEvent.setup();
  groups.data = new Map([
    group(5, 'OSUBB', 'ORG', 'organization', [5], true),
  ] as never);
  renderForm(5);
  await user.click(screen.getByRole('button', { name: 'Ghid de evaluare' }));
  const guide = await screen.findByRole('dialog', { name: 'Ghid de evaluare' });
  await user.click(
    within(guide).getByRole('button', {
      name: 'Setează Dificultate 2 stele, Nota 3 — Ședință Generală',
    }),
  );
  await user.click(within(guide).getByRole('button', { name: 'Gata' }));
  expect(screen.getByRole('radio', { name: /^2 stele — / })).toBeChecked();
  expect(nota()).toHaveAttribute('aria-valuenow', '3');
  groups.data = new Map();
});
