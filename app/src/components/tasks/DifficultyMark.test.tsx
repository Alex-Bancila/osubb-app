import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DifficultyMark } from './DifficultyMark';
import { previewPoints } from '../../lib/difficulty-levels';

it.each([
  [1, 'Dificultate 1 din 5', 'star', ''],
  [5, 'Dificultate 5 din 5', 'star', ''],
  [6, 'Dificultate Bronz', 'medal', '🥉Bronz'],
  [7, 'Dificultate Argint', 'medal', '🥈Argint'],
  [8, 'Dificultate Aur', 'medal', '🥇Aur'],
  [9, 'Dificultate Responsabil', 'text', 'Responsabil'],
  [10, 'Dificultate Coordonator', 'text', 'Coordonator'],
])('draws level %i as one named image (%s)', (value, name, kind, text) => {
  render(<DifficultyMark value={value} label="Dificultate" />);
  const mark = screen.getByRole('img', { name });
  expect(mark).toHaveAttribute('data-difficulty-kind', kind);
  expect(mark).toHaveTextContent(`Dificultate${text}`);
  // Stars stay five small stars, the first `value` filled (R29a).
  expect(mark.querySelectorAll('svg')).toHaveLength(kind === 'star' ? 5 : 0);
  expect(mark.querySelectorAll('svg.fill-brand-red')).toHaveLength(
    kind === 'star' ? value : 0,
  );
});

it('previews base points × the multiplier, as the server computes them', () => {
  const scale = {
    ratings: [
      { rating: 1, multiplier: -1 },
      { rating: 3, multiplier: 1 },
      { rating: 5, multiplier: 3 },
    ],
    difficulties: [
      { level: 3, base_points: 3 },
      { level: 6, base_points: 6 },
      { level: 10, base_points: 20 },
    ],
  };
  expect(previewPoints(scale, '10', '5')).toBe(60);
  expect(previewPoints(scale, 10, 1)).toBe(-20);
  expect(previewPoints(scale, '6', '3')).toBe(6);
  expect(previewPoints(scale, '', '3')).toBeNull();
  expect(previewPoints(scale, '4', '3')).toBeNull();
  expect(previewPoints(undefined, '3', '3')).toBeNull();
});
