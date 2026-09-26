import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CriticalAnnouncementBanner from './CriticalAnnouncementBanner';
import type { AnnouncementPresentation } from './announcements-presentation';

function presentation(
  overrides: Partial<AnnouncementPresentation> = {},
): AnnouncementPresentation {
  return {
    id: 1,
    title: 'Ședință extraordinară BC',
    body: 'Vineri la ora 18:00 în Aula Magna. Prezența obligatorie.',
    groupId: 1,
    group: { id: 1, name: 'OSUBB', short: 'OSUBB' },
    audience: 'org',
    audienceLabel: 'Toată organizația',
    author: 'BC',
    authorMember: null,
    priority: 'critical',
    category: 'organizatoric',
    pinned: true,
    formLabel: null,
    formUrl: null,
    publishedAt: '2026-09-18T15:00:00.000Z',
    publishedLabel: '18 septembrie 2026, 18:00',
    isRead: false,
    ...overrides,
  };
}

describe('CriticalAnnouncementBanner', () => {
  it('renders nothing when announcement is null', () => {
    const { container } = render(
      <CriticalAnnouncementBanner announcement={null} onOpen={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when announcement is already read', () => {
    const { container } = render(
      <CriticalAnnouncementBanner
        announcement={presentation({ isRead: true })}
        onOpen={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders banner with title, body, and action button for unread critical announcement', () => {
    render(
      <CriticalAnnouncementBanner
        announcement={presentation({ isRead: false, priority: 'critical' })}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Anunț critic: Ședință extraordinară BC/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Vineri la ora 18:00 în Aula Magna/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Citește acum/ }),
    ).toBeInTheDocument();
  });

  it('calls onOpen when action button is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation({ isRead: false, priority: 'critical' });

    render(<CriticalAnnouncementBanner announcement={item} onOpen={onOpen} />);

    await user.click(screen.getByRole('button', { name: /Citește acum/ }));
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it('calls onOpen when action button is activated via keyboard Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation({ isRead: false, priority: 'critical' });

    render(<CriticalAnnouncementBanner announcement={item} onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: /Citește acum/ });
    button.focus();
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it('does not trigger onOpen when clicking non-interactive alert container', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation({ isRead: false, priority: 'critical' });

    render(<CriticalAnnouncementBanner announcement={item} onOpen={onOpen} />);

    await user.click(screen.getByRole('alert'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
