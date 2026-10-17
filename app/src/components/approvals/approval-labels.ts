import type { ReviewOutcome } from '../../lib/approval-status';
import type { ApprovalKind } from '../../queries/approvals';

/** `3 cereri de aprobare` — the request icon's accessible name, in words. */
export function approvalRequestsLabel(count: number): string {
  if (count === 1) return '1 cerere de aprobare';
  // Romanian counts from twenty with "de".
  return count >= 20
    ? `${count} de cereri de aprobare`
    : `${count} cereri de aprobare`;
}

/**
 * What the page says after a decision, wherever the review was opened from:
 * the requests list, the item's card, chip or link.
 */
export const APPROVAL_RECEIPTS: Record<
  ApprovalKind,
  Record<ReviewOutcome, string>
> = {
  announcement: {
    approved: 'Anunțul a fost aprobat și publicat.',
    rejected: 'Anunțul a fost respins.',
  },
  event: {
    approved: 'Evenimentul a fost aprobat și publicat.',
    rejected: 'Evenimentul a fost respins.',
  },
};
