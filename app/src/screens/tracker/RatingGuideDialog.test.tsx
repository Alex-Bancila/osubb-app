import * as axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

const scale = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  data: {
    ratings: [],
    difficulties: [
      { stars: 1, note: 'Foarte ușor (ex. confirmare prezență).' },
      { stars: 2, note: 'Ușor (ex. minută).' },
      { stars: 3, note: 'Mediu (ex. grafică).' },
      { stars: 4, note: 'Greu (ex. logistică eveniment).' },
      { stars: 5, note: 'Foarte greu (ex. coordonare proiect).' },
    ],
  },
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => scale,
}));
import { RatingGuideDialog } from './RatingGuideDialog';
import { ratingGuide } from './rating-guide-content';
import * as guide from './rating-guide-content';

it('lists both scales with every hint, and no placeholder text', async () => {
  const user = userEvent.setup();
  render(<RatingGuideDialog />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Ghid de evaluare' });

  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', {
    name: 'Ghid de evaluare',
  });
  expect(dialog).toHaveAccessibleDescription(ratingGuide.description);

  const rating = within(dialog).getByRole('region', { name: 'Calificativ' });
  for (const hint of [
    'Nelivrat / inacceptabil',
    'Sub așteptări',
    'Conform așteptărilor',
    'Peste așteptări',
    'Excepțional',
  ])
    expect(within(rating).getByText(hint)).toBeVisible();
  expect(within(rating).getAllByRole('listitem')).toHaveLength(5);

  const difficulty = within(dialog).getByRole('region', {
    name: 'Dificultate',
  });
  for (const row of scale.data.difficulties)
    expect(within(difficulty).getByText(row.note)).toBeVisible();

  // R22: no placeholder or lorem text is left anywhere in the guide.
  expect(dialog).not.toHaveTextContent(/Text provizoriu|lorem|ipsum/i);
  expect(JSON.stringify(guide)).not.toMatch(/provizoriu|lorem|ipsum/i);

  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

it('can be opened from the keyboard', async () => {
  const user = userEvent.setup();
  render(<RatingGuideDialog />);
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'Ghid de evaluare' }),
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(
    await screen.findByRole('dialog', { name: 'Ghid de evaluare' }),
  ).toBeVisible();
});

it('offers a retry when the Difficulty notes cannot be read', async () => {
  const user = userEvent.setup();
  Object.assign(scale, { isError: true });
  render(<RatingGuideDialog />);
  await user.click(screen.getByRole('button', { name: 'Ghid de evaluare' }));
  await screen.findByRole('dialog', { name: 'Ghid de evaluare' });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca dificultățile.',
  );
  await user.click(screen.getByRole('button', { name: 'Reîncarcă' }));
  expect(scale.refetch).toHaveBeenCalled();
  // The Rating hints live in the app and stay readable.
  expect(screen.getByText('Conform așteptărilor')).toBeVisible();
  Object.assign(scale, { isError: false });
});
