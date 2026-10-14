import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  const sheet = () => (
    <AnnouncementReviewSheet
      id={3}
      open
      onOpenChange={vi.fn()}
      onDecided={vi.fn()}
    />
  );

  // Fails if the sheet waits for its row unseen: the click on a request
  // would seem to do nothing.
  it('opens at once and holds the place of the form while the row is read', () => {
    reads.useAnnouncement.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });

    render(sheet());

    const dialog = screen.getByRole('dialog', { name: 'Revizuiește anunțul' });
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Se încarcă anunțul…',
    );
  });

  // Fails if a failed read draws nothing, or offers no way to try again.
  it('says a failed read failed and reads it again on Reîncearcă', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    reads.useAnnouncement.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    });

    render(sheet());

    const dialog = screen.getByRole('dialog', { name: 'Revizuiește anunțul' });
    expect(
      within(dialog).getByText('Nu am putut încărca anunțul.'),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Reîncearcă' }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says so when the row is gone', () => {
    reads.useAnnouncement.mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(sheet());

    expect(
      within(
        screen.getByRole('dialog', { name: 'Revizuiește anunțul' }),
      ).getByText('Acest anunț nu mai există.'),
    ).toBeInTheDocument();
  });
});
