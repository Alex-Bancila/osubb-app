import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  useEvent: vi.fn(),
  useEventFormOptions: vi.fn(),
}));
vi.mock('../../queries/events', () => ({ useEvent: reads.useEvent }));
vi.mock('../../queries/event-creation', () => ({
  useEventFormOptions: reads.useEventFormOptions,
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({ data: undefined }),
}));
// #1012 (R37): opening a thing reads its Notifications; the hook's own
// behaviour is queries/notifications-read.test.tsx's.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', () => ({
  NO_SUBJECTS: [],
  useReadNotificationsAbout: readNotificationsAbout,
}));
// The review surface is the edit sheet's own suite (EventManageControls):
// here it names what it was handed.
vi.mock('./EventManageControls', () => ({
  EditEventSheet: ({
    event,
    open,
  }: {
    event: { title: string };
    open: boolean;
  }) => (open ? <div role="dialog" aria-label={event.title} /> : null),
}));

import { EventReviewSheet } from './EventReviewSheet';

describe('EventReviewSheet (spec 2026-10-11)', () => {
  beforeEach(() => {
    reads.useEvent.mockReset();
    reads.useEventFormOptions.mockReturnValue({ data: {} });
  });

  it('reviews its one Event, read by its id, in the Event form', () => {
    reads.useEvent.mockReturnValue({ data: { id: 71, title: 'Gala OSUBB' } });

    render(
      <EventReviewSheet
        id={71}
        open
        onOpenChange={vi.fn()}
        onDecided={vi.fn()}
      />,
    );

    expect(reads.useEvent).toHaveBeenCalledWith(71);
    expect(
      screen.getByRole('dialog', { name: 'Gala OSUBB' }),
    ).toBeInTheDocument();
  });

  // The request's own Notification ("Cerere de aprobare", subject event:<id>)
  // is read however the review opened: the list, the card, the chip, the
  // link — as the linked Agendă card reads it.
  it('reads its Notifications as soon as it opens, before the Event is in', () => {
    reads.useEvent.mockReturnValue({ data: undefined });

    render(
      <EventReviewSheet
        id={71}
        open
        onOpenChange={vi.fn()}
        onDecided={vi.fn()}
      />,
    );

    expect(readNotificationsAbout).toHaveBeenCalledWith(['event:71']);
  });
});
