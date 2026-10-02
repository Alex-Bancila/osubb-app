import type { DifficultyLevelRow } from '../lib/difficulty-levels';

/**
 * `public.task_difficulty_levels` as migration 20261002000126 seeds it (#985).
 * `setup.ts` serves it to every test through `useDifficultyLevels`.
 */
export const difficultyLevelsFixture: DifficultyLevelRow[] = [
  { level: 1, kind: 'star', label: '1 stea', glyph: '⭐', base_points: 1 },
  { level: 2, kind: 'star', label: '2 stele', glyph: '⭐⭐', base_points: 2 },
  { level: 3, kind: 'star', label: '3 stele', glyph: '⭐⭐⭐', base_points: 3 },
  {
    level: 4,
    kind: 'star',
    label: '4 stele',
    glyph: '⭐⭐⭐⭐',
    base_points: 4,
  },
  {
    level: 5,
    kind: 'star',
    label: '5 stele',
    glyph: '⭐⭐⭐⭐⭐',
    base_points: 5,
  },
  { level: 6, kind: 'medal', label: 'Bronz', glyph: '🥉', base_points: 6 },
  { level: 7, kind: 'medal', label: 'Argint', glyph: '🥈', base_points: 7 },
  { level: 8, kind: 'medal', label: 'Aur', glyph: '🥇', base_points: 8 },
  {
    level: 9,
    kind: 'text',
    label: 'Responsabil',
    glyph: null,
    base_points: 15,
  },
  {
    level: 10,
    kind: 'text',
    label: 'Coordonator',
    glyph: null,
    base_points: 20,
  },
];
