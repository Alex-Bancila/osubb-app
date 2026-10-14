import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAnnouncementRow } from '../../queries/announcements';

const reads = vi.hoisted(() => ({
  useAnnouncement: vi.fn(),
}));
vi.mock('../../queries/announcements', () => ({
  useAnnouncement: reads.useAnnouncement,
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({ data: undefined }),
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({ data: undefined }),
}));
// The review surface is the edit sheet's own suite: here it names what it
// was handed.
vi.mock('./AnnouncementEditSheet', () => ({
  default: ({
    announcement,
    open,
  }: {
    announcement: { title: string; approvalStatus: string };
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={announcement.title}>
        {announcement.approvalStatus}
      </div>
    ) : null,
}));

import { AnnouncementReviewSheet } from './AnnouncementReviewSheet';

function pending(): RawAnnouncementRow {
  return {
    id: 3,
    title: 'Burse',
    body: 'Detalii',
    group_id: 1,
    audience: 'org',
    priority: 'normal',
    pinned: false,
    links: [],
    published_at: '2026-10-11T09:00:00Z',
    deadline: null,
    min_level: 0,
    created_by: 'ana',
    approval_status: 'pending',
    rejection_reason: null,
    announcement_reads: [],
  } as unknown as RawAnnouncementRow;
}

describe('AnnouncementReviewSheet (spec 2026-10-11)', () => {
  beforeEach(() => {
    reads.useAnnouncement.mockReset();
  });

  // R56: the feed is read by the page, so the request under review is read
  // by its id rather than looked for among the loaded rows.
  it('reads its one Announcement by its id and reviews it', () => {
    reads.useAnnouncement.mockReturnValue({ data: pending() });

    render(
      <AnnouncementReviewSheet
        id={3}
        open
        onOpenChange={vi.fn()}
        onDecided={vi.fn()}
      />,
    );

    expect(reads.useAnnouncement).toHaveBeenCalledWith(3);
    expect(screen.getByRole('dialog', { name: 'Burse' })).toHaveTextContent(
      'pending',
    );
  });

  it('draws nothing until the row is read, or when it cannot be', () => {
    reads.useAnnouncement.mockReturnValue({ data: undefined });
    const { rerender } = render(
      <AnnouncementReviewSheet
        id={3}
        open
        onOpenChange={vi.fn()}
        onDecided={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    reads.useAnnouncement.mockReturnValue({ data: null });
    rerender(
      <AnnouncementReviewSheet
        id={3}
        open
        onOpenChange={vi.fn()}
        onDecided={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
