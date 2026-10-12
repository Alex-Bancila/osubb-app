import { useState } from 'react';
import { MailQuestion } from 'lucide-react';
import {
  useApprovalRequests,
  type ApprovalKind,
  type ApprovalRequest,
} from '../../queries/approvals';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { approvalRequestsLabel } from './approval-labels';
import { ApprovalRequestsSheet } from './ApprovalRequestsSheet';

/**
 * The request icon (spec 2026-10-11): shown only to a viewer who decides and
 * only while requests of this page's kind exist, with their count in a badge
 * as the notifications bell shows its; it opens the requests sheet. The row
 * chosen there is handed to `onReview` — the item's own form in review mode,
 * which the host renders.
 */
export function ApprovalRequestsButton({
  kind,
  onReview,
  receipt,
}: {
  kind: ApprovalKind;
  onReview?: (request: ApprovalRequest) => void;
  receipt?: string | null;
}) {
  const requests = useApprovalRequests(kind);
  const [open, setOpen] = useState(false);
  const count = requests.data?.length ?? 0;
  if (count === 0) return null;
  return (
    <>
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
      <ApprovalRequestsSheet
        kind={kind}
        requests={requests.data ?? []}
        open={open}
        onOpenChange={setOpen}
        onReview={(request) => onReview?.(request)}
        receipt={
          receipt ? (
            <p role="status" className="m-0 text-sm">
              {receipt}
            </p>
          ) : null
        }
      />
    </>
  );
}
