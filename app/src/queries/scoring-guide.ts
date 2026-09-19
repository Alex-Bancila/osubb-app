import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export async function fetchScoringGuide() {
  const [ratings, difficulties] = await Promise.all([
    supabase
      .from('rating_guide')
      .select('rating, multiplier, label, note')
      .order('rating'),
    supabase.from('difficulty_guide').select('stars, note').order('stars'),
  ]);
  if (ratings.error) throw ratings.error;
  if (difficulties.error) throw difficulties.error;
  return { ratings: ratings.data, difficulties: difficulties.data };
}
export function useScoringGuide() {
  return useQuery({
    queryKey: ['reference', 'scoring-guide'],
    queryFn: fetchScoringGuide,
    staleTime: Infinity,
  });
}
