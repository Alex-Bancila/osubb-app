import { useMemo } from 'react';
import { useAnnouncementsFeed } from '../../queries/announcements';
import type { ReviewOutcome } from '../../queries/approvals';
import { useMemberIdentities } from '../../queries/member-identities';
import { useGroups } from '../../queries/reference';
import AnnouncementEditSheet from './AnnouncementEditSheet';
import { toAnnouncementPresentation } from './announcements-presentation';

/**
 * BC's review of one OSUBB-wide Announcement (spec 2026-10-11): the edit
 * sheet in review mode over the row as the feed holds it — BC reads every
 * pending Announcement — so what is approved is what the author wrote,
 * corrected where BC chose to. Nothing is drawn until the feed has the row.
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
  const feed = useAnnouncementsFeed();
  const groups = useGroups();
  const row = feed.data?.find((candidate) => candidate.id === id);
  const authors = useMemberIdentities(row?.created_by ? [row.created_by] : []);
  const announcement = useMemo(
    () =>
      row ? toAnnouncementPresentation(row, groups.data, authors.data) : null,
    [row, groups.data, authors.data],
  );
  if (!announcement) return null;
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
