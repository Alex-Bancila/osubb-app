import { useMemo } from 'react';
import { EmptyState } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { FormSheet } from '../../components/ui/form-sheet';
import { useAnnouncement } from '../../queries/announcements';
import type { ReviewOutcome } from '../../queries/approvals';
import { useMemberIdentities } from '../../queries/member-identities';
import { useGroups } from '../../queries/reference';
import AnnouncementEditSheet from './AnnouncementEditSheet';
import { toAnnouncementPresentation } from './announcements-presentation';

/** The review sheet's title, the same before and after its row is read. */
const REVIEW_TITLE = 'Revizuiește anunțul';

/**
 * BC's review of one OSUBB-wide Announcement (spec 2026-10-11): the edit
 * sheet in review mode over the row read by its id — BC reads every pending
 * Announcement — so what is approved is what the author wrote, corrected
 * where BC chose to. The row is read by its id (R56: the feed is read by the
 * page, so the row need not be among its loaded rows); until it is, the
 * sheet opens on its place, or on why it cannot be shown.
 */
export function AnnouncementReviewSheet({
  id,
  open,
  onOpenChange,
  onDecided,
}: {
  id: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: (outcome: ReviewOutcome) => void;
}) {
  const read = useAnnouncement(id);
  const row = read.data ?? null;
  const groups = useGroups();
  const authors = useMemberIdentities(row?.created_by ? [row.created_by] : []);
  const announcement = useMemo(
    () =>
      row ? toAnnouncementPresentation(row, groups.data, authors.data) : null,
    [row, groups.data, authors.data],
  );
  if (!announcement)
    return (
      <FormSheet open={open} onOpenChange={onOpenChange} title={REVIEW_TITLE}>
        {read.isError ? (
          <ErrorState
            error={read.error}
            text="Nu am putut încărca anunțul."
            retryLabel="Reîncearcă"
            onRetry={() => void read.refetch()}
            retrying={read.isFetching}
          />
        ) : read.data === null ? (
          <EmptyState bare>Acest anunț nu mai există.</EmptyState>
        ) : (
          <Loading label="Se încarcă anunțul…" />
        )}
      </FormSheet>
    );
  return (
    <AnnouncementEditSheet
      key={id}
      announcement={announcement}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={() => onOpenChange(false)}
      review={{ onDecided }}
    />
  );
}
