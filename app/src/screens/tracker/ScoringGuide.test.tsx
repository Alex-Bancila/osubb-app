import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  data: {
    ratings: [
      { rating: 1, multiplier: -2, label: 'Slab', note: 'Ghid canonic' },
      { rating: 2, multiplier: 0, label: 'Insuficient', note: null },
      { rating: 3, multiplier: 7, label: 'Bun', note: null },
    ],
    difficulties: [{ stars: 1, note: 'Foarte ușor' }],
  },
}));
vi.mock('../../queries/scoring-guide', () => ({
  useScoringGuide: () => state,
}));
import { ScoringGuide } from './ScoringGuide';
beforeEach(() => {
  state.isPending = false;
  state.isError = false;
});
it('uses database multipliers and explains negative, zero and positive outcomes in text', () => {
  render(<ScoringGuide />);
  expect(screen.getByText(/× -2/)).toBeVisible();
  expect(screen.getByText(/× 7/)).toBeVisible();
  expect(screen.getByText('Se scad puncte.')).toBeVisible();
  expect(screen.getByText('Nu se acordă puncte.')).toBeVisible();
  expect(screen.getByText('Se acordă puncte.')).toBeVisible();
});
it('opens difficulty guidance with the keyboard and has no accessibility violations', async () => {
  const user = userEvent.setup();
  const { container } = render(<ScoringGuide />);
  await user.tab();
  expect(screen.getByText('Ghid de dificultate (1–5)')).toHaveFocus();
  await user.click(screen.getByText('Ghid de dificultate (1–5)'));
  expect(screen.getByText(/Foarte ușor/)).toBeVisible();
  expect((await axe.run(container)).violations).toEqual([]);
});
it('reports loading and offers retry on failure', async () => {
  state.isPending = true;
  const view = render(<ScoringGuide />);
  expect(screen.getByRole('status')).toBeVisible();
  state.isPending = false;
  state.isError = true;
  view.rerender(<ScoringGuide />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă ghidul' }),
  );
  expect(state.refetch).toHaveBeenCalled();
});
