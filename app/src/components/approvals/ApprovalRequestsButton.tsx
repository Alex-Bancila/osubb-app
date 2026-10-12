import { useState } from 'react';
import { MailQuestion } from 'lucide-react';
import {
  useApprovalRequests,
  type ApprovalKind,
  type ApprovalRequest,
  type ReviewOutcome,
} from '../../queries/approvals';
import { AnnouncementReviewSheet } from '../../screens/announcements/AnnouncementReviewSheet';
import { EventReviewSheet } from '../../screens/calendar/EventReviewSheet';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { approvalRequestsLabel } from './approval-labels';
import { ApprovalRequestsSheet } from './ApprovalRequestsSheet';

/** What the list says under itself after a decision, until it closes. */
const RECEIPTS: Record<ApprovalKind, Record<ReviewOutcome, string>> = {
  announcement: {
    approved: 'Anunțul a fost aprobat și publicat.',
    rejected: 'Anunțul a fost respins.',
  },
  event: {
    approved: 'Evenimentul a fost aprobat și publicat.',
    rejected: 'Evenimentul a fost respins.',
  },
};

/**
 * The request icon (spec 2026-10-11): shown only to a viewer who decides and
 * only while requests of this page's kind exist, with their count in a badge
 * as the notifications bell shows its; it opens the requests sheet. A row
 * chosen there opens the item's own form in review mode over the list, and
 * the decision's receipt sits under the list until it closes.
 */
export function ApprovalRequestsButton({ kind }: { kind: ApprovalKind }) {
  const requests = useApprovalRequests(kind);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ApprovalRequest | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const count = requests.data?.length ?? 0;
  // The last decision empties the list while it is still open: it stays, with
  // its receipt, until the viewer closes it.
  if (count === 0 && !open) return null;

  function decided(outcome: ReviewOutcome) {
    setReviewing(null);
    setReceipt(RECEIPTS[kind][outcome]);
  }

  return (
    <>
      {count > 0 && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={approvalRequestsLabel(count)}
          className="relative"
          onClick={() => setOpen(true)}
        >
          <MailQuestion aria-hidden="true" />
          <Badge
            variant="destructive"
            className="absolute -top-1.5 -right-1.5 h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-white ring-2 ring-background dark:bg-destructive"
          >
            <span aria-hidden="true">{count}</span>
          </Badge>
        </Button>
      )}
      <ApprovalRequestsSheet
        kind={kind}
        requests={requests.data ?? []}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReceipt(null);
        }}
        onReview={setReviewing}
        receipt={
          receipt ? (
            <p role="status" className="m-0 text-sm">
              {receipt}
            </p>
          ) : null
        }
      />
      {reviewing?.kind === 'announcement' && (
        <AnnouncementReviewSheet
          id={reviewing.id}
          open
          onOpenChange={(next) => {
            if (!next) setReviewing(null);
          }}
          onDecided={decided}
        />
      )}
      {reviewing?.kind === 'event' && (
        <EventReviewSheet
          id={reviewing.id}
          open
          onOpenChange={(next) => {
            if (!next) setReviewing(null);
          }}
          onDecided={decided}
        />
      )}
    </>
  );
}
