import { useQuery } from '@tanstack/react-query';
import type { DifficultyLevelRow } from '../lib/difficulty-levels';
import { difficultyKindSchema } from '../lib/schemas/evaluation';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * The ten Difficulty levels from `public.task_difficulty_levels` (#985): how
 * each is drawn (kind, label, glyph) and its base points. Reference data that
 * changes only in a migration, so one cached read serves every card, picker
 * and the rating guide (`staleTime: Infinity`; the live-change channel
 * invalidates `reference` if a migration ever changes it while the app is open).
 */
export function useDifficultyLevels() {
  return useQuery({
    queryKey: keys.reference.difficultyLevels(),
    staleTime: Infinity,
    queryFn: async (): Promise<DifficultyLevelRow[]> => {
      const { data, error } = await supabase
        .from('task_difficulty_levels')
        .select('level, kind, label, glyph, base_points')
        .order('level');
      if (error) throw error;
      return data.map((row) => ({
        ...row,
        kind: difficultyKindSchema.parse(row.kind),
      }));
    },
  });
}
