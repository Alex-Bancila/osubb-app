import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { parseOrRefuse } from '../lib/form-errors';
import { evaluationSchema } from '../lib/schemas/evaluation';
import { noteSchema } from '../lib/schemas/note';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
export type PendingDecision = {
  id: number;
  description: string;
  requester_id: string;
  requester_name: string;
  /** The Requester's Nickname (#675); null when they chose none. */
  requester_nickname?: string | null;
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
/** A refused decision, in the shared copy of `command-reasons.ts`. */
export class RequestDecisionError extends CommandError {}
const FAILED = 'Nu am putut salva decizia. Reîncearcă.';
async function sendDecision(input: RequestDecision) {
  if (input.kind === 'approve') {
    const values = parseOrRefuse(evaluationSchema, input, FAILED);
    return supabase.rpc('approve_completed_work_request', {
      p_request_id: input.requestId,
      p_difficulty: values.difficulty,
      p_rating: values.rating,
      p_note: values.note,
    });
  }
  const { note } = parseOrRefuse(noteSchema, input, FAILED);
  return supabase.rpc('reject_completed_work_request', {
    p_request_id: input.requestId,
    p_note: note,
  });
}
export async function decideRequest(input: RequestDecision) {
  const { data, error } = await sendDecision(input);
  if (error) throw new RequestDecisionError(error, FAILED);
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
