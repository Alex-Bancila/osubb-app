import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
export type PendingDecision = {
  id: number;
  description: string;
  requester_id: string;
  requester_name: string;
  group_id: number;
  group_name: string;
  created_at: string;
};
export async function fetchPendingDecisions(): Promise<PendingDecision[]> {
  const rows: PendingDecision[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .rpc('pending_request_decisions')
      .order('created_at')
      .order('id')
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
export function usePendingDecisions() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.requests.decisions(memberId),
    queryFn: memberId ? fetchPendingDecisions : skipToken,
  });
}
export type RequestDecision =
  | {
      kind: 'approve';
      requestId: number;
      difficulty: number;
      rating: number;
      note: string;
    }
  | { kind: 'reject'; requestId: number; note: string };
export class RequestDecisionError extends Error {}
export async function decideRequest(input: RequestDecision) {
  if (!input.note.trim())
    throw new RequestDecisionError('Scrie o notă pentru această decizie.');
  if (
    input.kind === 'approve' &&
    (!Number.isInteger(input.difficulty) ||
      input.difficulty < 1 ||
      input.difficulty > 5 ||
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5)
  )
    throw new RequestDecisionError('Alege Dificultatea și Calificativul.');
  const { data, error } =
    input.kind === 'approve'
      ? await supabase.rpc('approve_completed_work_request', {
          p_request_id: input.requestId,
          p_difficulty: input.difficulty,
          p_rating: input.rating,
          p_note: input.note.trim(),
        })
      : await supabase.rpc('reject_completed_work_request', {
          p_request_id: input.requestId,
          p_note: input.note.trim(),
        });
  if (error)
    throw new RequestDecisionError(
      error.code === 'PT409'
        ? 'Cererea a fost deja decisă. Lista a fost actualizată.'
        : error.code === '42501'
          ? 'Nu mai ai permisiunea de a decide această cerere.'
          : error.code === 'PT404'
            ? 'Cererea nu mai este disponibilă.'
            : 'Nu am putut salva decizia. Reîncearcă.',
    );
  return data;
}
export function useRequestDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: decideRequest,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.requests.all }),
        client.invalidateQueries({ queryKey: keys.tasks.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
      ]),
  });
}
