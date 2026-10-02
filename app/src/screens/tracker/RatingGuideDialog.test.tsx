import * as axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const scale = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  data: {
    ratings: [
      { rating: 1, multiplier: -1, label: '' },
      { rating: 2, multiplier: 0, label: '' },
      { rating: 3, multiplier: 1, label: '' },
      { rating: 4, multiplier: 2, label: '' },
      { rating: 5, multiplier: 3, label: '' },
    ],
    difficulties: [1, 2, 3, 4, 5, 6, 7, 8, 15, 20].map(
      (base_points, index) => ({
        level: index + 1,
        kind: '',
        label: '',
        glyph: null,
        base_points,
      }),
    ),
  } as unknown,
}));
const groups = vi.hoisted(() => ({
  data: new Map<number, unknown>(),
  isPending: false,
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => scale,
  useGroups: () => groups,
}));
import { RatingGuideDialog } from './RatingGuideDialog';
import { ratingGuide } from './rating-guide';
import * as guide from './rating-guide';

const group = (
  id: number,
  name: string,
  short: string | null,
  category: string,
  path: number[],
  is_organization = false,
) =>
  [
    id,
    { id, name, short, category, path, is_organization, color: '#284C93' },
  ] as const;

beforeEach(() => {
  groups.data = new Map([
    group(5, 'OSUBB', 'ORG', 'organization', [5], true),
    group(8, 'Educațional', 'EDU', 'department', [8]),
    group(6, 'Diverse', 'DIV', 'department', [6]),
    group(60, 'Festivalul Studențesc 2026', null, 'project', [60]),
  ]);
});

async function open(props: Parameters<typeof RatingGuideDialog>[0] = {}) {
  const user = userEvent.setup();
  render(<RatingGuideDialog {...props} />);
  await user.click(screen.getByRole('button', { name: 'Ghid de evaluare' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Ghid de evaluare',
  });
  return { user, dialog };
}

it('shows the general guide — every Nota, the ten Difficulty levels, the experience rule — and no placeholder', async () => {
  // Diverse has no list: the scale alone, no view switch.
  const { user, dialog } = await open({ groupId: 6 });
  expect(dialog).toHaveAccessibleDescription(ratingGuide.description);
  expect(dialog).toHaveTextContent(
    'Grupul taskului:Diverse· nu are încă o listă de taskuri în ghid',
  );
  expect(
    within(dialog).queryByRole('group', { name: 'Partea ghidului' }),
  ).toBeNull();

  const rating = within(dialog).getByRole('region', { name: 'Nota' });
  expect(within(rating).getAllByRole('listitem')).toHaveLength(5);
  for (const row of ratingGuide.ratings)
    expect(within(rating).getByText(row.interpretation)).toBeVisible();
  expect(within(rating).getByText('Multiplicator ×−1')).toBeVisible();
  // R29a: Nota is a bare number, never a picture.
  expect(within(rating).queryByRole('img')).toBeNull();

  const difficulty = within(dialog).getByRole('region', {
    name: 'Dificultate',
  });
  expect(within(difficulty).getAllByRole('listitem')).toHaveLength(10);
  for (const row of ratingGuide.difficulties)
    expect(within(difficulty).getByText(row.interpretation)).toBeVisible();
  expect(
    within(difficulty)
      .getAllByRole('img')
      .map((mark) => mark.getAttribute('aria-label')),
  ).toEqual([
    ...[1, 2, 3, 4, 5].map((n) => `Dificultate ${n} din 5`),
    'Dificultate Bronz',
    'Dificultate Argint',
    'Dificultate Aur',
    'Dificultate Responsabil',
    'Dificultate Coordonator',
  ]);
  expect(within(difficulty).getByText('20 puncte de bază')).toBeVisible();

  const experience = within(dialog).getByRole('region', {
    name: 'Nivel de experiență',
  });
  expect(experience).toHaveTextContent(ratingGuide.experiences.incepator.rule);
  expect(experience).toHaveTextContent(ratingGuide.experiences.avansat.rule);
  // Intermediar only where a list has that column.
  expect(experience).not.toHaveTextContent('Intermediar');

  // The sheet's placeholders ("Ceva", "Altceva", "încă ceva") are not shipped.
  expect(dialog).not.toHaveTextContent(/\bCeva\b|Altceva|încă ceva|lorem/i);
  expect(JSON.stringify(guide)).not.toMatch(
    /"Ceva"|Altceva|încă ceva|provizoriu|lorem|ipsum/i,
  );
  // Read-only without a form: no Setează anywhere.
  expect(within(dialog).queryByRole('button', { name: /^Setează/ })).toBeNull();

  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen.getByRole('button', { name: 'Ghid de evaluare' }),
  ).toHaveFocus();
});

it('opens on the Group list, with one Setează per experience column', async () => {
  const onSet = vi.fn();
  const { user, dialog } = await open({ groupId: 8, onSet });
  const toggle = within(dialog).getByRole('group', {
    name: 'Partea ghidului',
  });
  expect(
    within(toggle).getByRole('button', { name: 'Taskuri EDU' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const list = within(dialog).getByRole('region', {
    name: 'Taskuri în Educațional',
  });
  // A merged cell is one Setează for every level; split cells one each.
  expect(
    within(list).getByRole('button', {
      name: 'Setează Dificultate 2 stele — Ședință departamentală',
    }),
  ).toHaveTextContent('Setează');
  const beginner = within(list).getByRole('button', {
    name: 'Setează Începător, Dificultate 3 stele — Voluntar contactări',
  });
  expect(beginner).toHaveTextContent('Începător');
  expect(
    within(list).getByRole('button', {
      name: 'Setează Avansat, Dificultate 2 stele — Voluntar contactări',
    }),
  ).toBeVisible();
  // "🥇/🥈/🥉": the evaluator picks the medal.
  for (const medal of ['Bronz', 'Argint', 'Aur'])
    expect(
      within(list).getByRole('button', {
        name: `Setează Dificultate ${medal} — Responsabil echipă`,
      }),
    ).toBeVisible();

  await user.click(beginner);
  expect(onSet).toHaveBeenLastCalledWith({ difficulty: 3 });
  expect(within(dialog).getByRole('status')).toHaveTextContent(
    'Setat în formular: Dificultate 3 stele.',
  );

  await user.click(
    within(toggle).getByRole('button', { name: 'Note și dificultăți' }),
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Setează Dificultate Aur' }),
  );
  expect(onSet).toHaveBeenLastCalledWith({ difficulty: 8 });
  await user.click(
    within(dialog).getByRole('button', { name: 'Setează Nota 2' }),
  );
  expect(onSet).toHaveBeenLastCalledWith({ rating: 2 });
});

it('marks what the form holds and shows it in the bar above Gata', async () => {
  const { dialog } = await open({
    groupId: 6,
    selection: { difficulty: 9, rating: 4 },
    onSet: vi.fn(),
  });
  expect(
    within(dialog).getByRole('button', {
      name: 'Setează Dificultate Responsabil',
    }),
  ).toHaveAttribute('data-applied', 'true');
  expect(
    within(dialog).getByRole('button', { name: 'Setează Nota 4' }),
  ).toHaveAttribute('data-applied', 'true');
  expect(
    within(dialog).getByRole('button', { name: 'Setează Nota 3' }),
  ).not.toHaveAttribute('data-applied');
  expect(dialog).toHaveTextContent('În formularDificultateResponsabilNota4');
  expect(within(dialog).getByRole('button', { name: 'Gata' })).toBeVisible();
});

it('searches the Proiecte list, by Domeniu, ignoring diacritics', async () => {
  const { user, dialog } = await open({ groupId: 60, onSet: vi.fn() });
  const search = within(dialog).getByRole('searchbox', {
    name: 'Caută în taskurile din Proiecte',
  });
  expect(within(dialog).getByText('87 taskuri')).toBeVisible();
  expect(
    within(dialog).getByRole('region', { name: 'LOGISTICĂ' }),
  ).toBeVisible();
  await user.type(search, 'sedinta');
  expect(within(dialog).getByText('5 taskuri găsite')).toBeVisible();
  expect(
    within(dialog).queryByRole('region', { name: 'LOGISTICĂ' }),
  ).toBeNull();
  expect(
    within(dialog).getByRole('button', {
      name: 'Setează Dificultate 3 stele — Ședință de lucru',
    }),
  ).toBeVisible();
  await user.clear(search);
  await user.type(search, 'zzz');
  expect(
    within(dialog).getByText('Niciun task nu conține „zzz”.'),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge căutarea' }),
  );
  expect(search).toHaveValue('');
  expect(
    within(dialog).getByRole('button', {
      name: 'Setează Dificultate Coordonator — Coordonator principal',
    }),
  ).toBeVisible();
});

it('asks for the Group when the form has none yet, and opens from the keyboard', async () => {
  const user = userEvent.setup();
  render(<RatingGuideDialog groupId={null} onSet={vi.fn()} />);
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'Ghid de evaluare' }),
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', {
    name: 'Ghid de evaluare',
  });
  expect(dialog).toHaveTextContent(
    'Alege grupul taskului ca să vezi și lista lui de taskuri.',
  );
  expect(within(dialog).getByRole('region', { name: 'Nota' })).toBeVisible();
});

it('keeps the guide readable without the reference data', async () => {
  const data = scale.data;
  Object.assign(scale, { isError: true, data: undefined });
  const { dialog } = await open({ groupId: 6 });
  // The words live in the app; only the multipliers and base points wait.
  expect(
    within(dialog).getByText(ratingGuide.ratings[2]?.interpretation ?? ''),
  ).toBeVisible();
  expect(within(dialog).queryByText(/puncte de bază/)).toBeNull();
  Object.assign(scale, { isError: false, data });
});
