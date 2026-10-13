import type { ReactNode } from 'react';
import { formatBucharestDay } from '../../lib/calendar-time';
import type { ApprovalKind, ApprovalRequest } from '../../queries/approvals';
import { useMemberIdentities } from '../../queries/member-identities';
import { useGroups } from '../../queries/reference';
import { formatAnnouncementDate } from '../../screens/announcements/announcements-presentation';
import { MemberName } from '../member/MemberName';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../ui/sheet';

const DESCRIPTION: Record<ApprovalKind, string> = {
  announcement: 'Anunțurile pentru întreaga OSUBB care așteaptă decizia BC.',
  event: 'Evenimentele pentru întreaga OSUBB care așteaptă decizia BC.',
};

/**
 * The Cereri de aprobare of one page (spec 2026-10-11): the pending OSUBB-wide
 * Announcements (Anunțuri) or Events (Calendar), newest first, each with its
 * author, Group and when it was asked — an Event with its day too. A row's
 * title opens the item's own form in review mode (`onReview`); the receipt of
 * the last decision sits under the list until the sheet closes.
 */
export function ApprovalRequestsSheet({
  kind,
  requests,
  open,
  onOpenChange,
  onReview,
  receipt,
}: {
  kind: ApprovalKind;
  requests: readonly ApprovalRequest[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (request: ApprovalRequest) => void;
  receipt?: ReactNode;
}) {
  const members = useMemberIdentities(
    requests.flatMap((request) =>
      request.createdBy ? [request.createdBy] : [],
    ),
  );
  const groups = useGroups();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="bottom" className="gap-5 p-4 sm:max-w-2xl sm:p-6">
          <SheetHeader>
            <SheetTitle>Cereri de aprobare</SheetTitle>
            <SheetDescription>{DESCRIPTION[kind]}</SheetDescription>
          </SheetHeader>
          {requests.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">
              Nicio cerere în așteptare.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {requests.map((request) => {
                const group = groups.data?.get(request.groupId);
                const author = request.createdBy
                  ? (members.data?.get(request.createdBy) ?? {
                      memberId: request.createdBy,
                      fullName: 'Membru OSUBB',
                    })
                  : null;
                return (
                  <li
                    key={`${request.kind}-${request.id}`}
                    className="grid gap-1.5 rounded-lg border border-border bg-card p-3"
                  >
                    <button
                      type="button"
                      aria-label={`Revizuiește: ${request.title}`}
                      onClick={() => onReview(request)}
                      className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left font-heading text-base leading-snug font-semibold text-foreground outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
                    >
                      {request.title}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {author && (
                        <MemberName {...author} size="sm" className="text-xs" />
                      )}
                      <span>
                        {group
                          ? group.is_organization
                            ? 'OSUBB'
                            : group.name
                          : 'Grup'}
                      </span>
                      <span>
                        cerută{' '}
                        <time dateTime={request.createdAt}>
                          {formatAnnouncementDate(request.createdAt)}
                        </time>
                      </span>
                      {request.startsAt && (
                        <span>
                          <time dateTime={request.startsAt}>
                            {formatBucharestDay(request.startsAt)}
                          </time>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {receipt}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
