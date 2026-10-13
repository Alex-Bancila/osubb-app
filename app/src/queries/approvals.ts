import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  approvalStatusOf,
  type ApprovalStatus,
  type ReviewOutcome,
} from '../lib/approval-status';
import { useAuth } from '../lib/auth';
import { useCapability } from '../lib/capabilities';
import { CommandError } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * Cereri de aprobare (spec 2026-10-11): an Announcement or Event aimed at the
 * whole OSUBB by a writer below BC is `pending` until a BC member or the
 * Moderator approves it from its own form or rejects it with a reason; the
 * rows behind the request icons in Calendar and Anunțuri come from one read.
 */

// The status and its reader live in lib/approval-status, so a presentation
// module never imports the Supabase client through this file.
export { approvalStatusOf, type ApprovalStatus, type ReviewOutcome };
export type ApprovalKind = 'announcement' | 'event';

export type ApprovalRequest = {
  kind: ApprovalKind;
  id: number;
  title: string;
  groupId: number;
  createdBy: string | null;
  /** When it was asked (the Announcement's published_at, the Event's created_at). */
  createdAt: string;
  /** The Event's start; null for an Announcement. */
  startsAt: string | null;
};

type RequestRow =
  Database['public']['Functions']['approval_requests']['Returns'][number];

/** `approval_requests()`: empty for anyone below BC, newest first. */
export async function fetchApprovalRequests(): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase.rpc('approval_requests');
  if (error) throw error;
  return ((data ?? []) as RequestRow[]).map((row) => ({
    kind: row.kind === 'event' ? 'event' : 'announcement',
    id: row.id,
    title: row.title,
    groupId: row.group_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startsAt: row.starts_at,
  }));
}

/**
 * The requests, read only for a viewer who decides them (`manageRoles`: BC
 * or the Moderator); `kind` narrows to one page's. `data` stays undefined
 * for everyone else, so the icon renders nothing.
 */
export function useApprovalRequests(kind?: ApprovalKind) {
  const memberId = useAuth().session?.user.id;
  const decides = useCapability('manageRoles').data === true;
  return useQuery({
    queryKey: keys.approvals.list(memberId),
    queryFn: memberId && decides ? fetchApprovalRequests : skipToken,
    select: (rows: ApprovalRequest[]) =>
      kind ? rows.filter((row) => row.kind === kind) : rows,
  });
}

const DECISION_FAILED = 'Nu am putut salva decizia. Încearcă din nou.';

export async function approveAnnouncement({ id }: { id: number }) {
  const { data, error } = await supabase.rpc('approve_announcement', {
    p_id: id,
  });
  if (error) throw new CommandError(error, DECISION_FAILED);
  return data;
}

export async function rejectAnnouncement({
  id,
  reason,
}: {
  id: number;
  reason: string;
}) {
  const { data, error } = await supabase.rpc('reject_announcement', {
    p_id: id,
    p_reason: reason,
  });
  if (error) throw new CommandError(error, DECISION_FAILED);
  return data;
}

export async function approveEvent({ id }: { id: number }) {
  const { data, error } = await supabase.rpc('approve_event', { p_id: id });
  if (error) throw new CommandError(error, DECISION_FAILED);
  return data;
}

export async function rejectEvent({
  id,
  reason,
}: {
  id: number;
  reason: string;
}) {
  const { data, error } = await supabase.rpc('reject_event', {
    p_id: id,
    p_reason: reason,
  });
  if (error) throw new CommandError(error, DECISION_FAILED);
  return data;
}

/** A decision changes the list, the item's feed, and the notifications it sends. */
function useDecision<TArgs, TData>(decide: (args: TArgs) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: decide,
    onSettled: () =>
      Promise.all(
        [
          keys.approvals.all,
          keys.announcements.all,
          keys.events.all,
          keys.notifications.all,
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

export function useApproveAnnouncement() {
  return useDecision(approveAnnouncement);
}
export function useRejectAnnouncement() {
  return useDecision(rejectAnnouncement);
}
export function useApproveEvent() {
  return useDecision(approveEvent);
}
export function useRejectEvent() {
  return useDecision(rejectEvent);
}
