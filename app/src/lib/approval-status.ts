/**
 * The approval of an OSUBB-wide Announcement or Event (spec 2026-10-11), as
 * the presentations carry it. Pure: the presentation modules read it without
 * touching the query layer or the Supabase client.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** What BC's review of one request ends in. */
export type ReviewOutcome = Exclude<ApprovalStatus, 'pending'>;

/** The stored status; a row read before the flow existed is approved. */
export function approvalStatusOf(
  value: string | null | undefined,
): ApprovalStatus {
  return value === 'pending' || value === 'rejected' ? value : 'approved';
}
