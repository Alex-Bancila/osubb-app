import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AnnouncementCard from './AnnouncementCard';
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

describe('AnnouncementCard', () => {
  it('renders title, body, author, and formatted date', () => {
    render(<AnnouncementCard announcement={presentation()} onOpen={vi.fn()} />);

    expect(screen.getByText('Ședință extraordinară BC')).toBeInTheDocument();
    expect(
      screen.getByText(/Vineri la ora 18:00 în Aula Magna/),
    ).toBeInTheDocument();
    expect(screen.getByText('18 septembrie 2026, 18:00')).toBeInTheDocument();
  });

  it('renders pinned badge when pinned is true', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ pinned: true })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Fixat')).toBeInTheDocument();
  });

  it('does not render pinned badge when pinned is false', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ pinned: false })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText('Fixat')).not.toBeInTheDocument();
  });

  it('renders priority badge correctly for critical priority', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ priority: 'critical' })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Critic')).toBeInTheDocument();
  });

  it('renders priority badge correctly for important priority', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ priority: 'important' })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Important')).toBeInTheDocument();
  });

  it('renders department badge with department color', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          groupId: 2,
          group: {
            id: 2,
            name: 'Educațional',
            short: 'EDU',
            color: '#284C93',
          },
        })}
        onOpen={vi.fn()}
      />,
    );

    const deptBadge = screen.getByText('EDU');
    expect(deptBadge).toBeInTheDocument();
    expect(deptBadge).toHaveStyle({ backgroundColor: '#284C93' });
  });

  it('renders OSUBB for org-wide announcements', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          audience: 'org',
          audienceLabel: 'Toată organizația',
        })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('OSUBB')).toBeInTheDocument();
  });

  it('renders neutral fallback badge when department is unresolved and does not label it OSUBB', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          groupId: 99,
          group: { id: 99, name: 'Grup', short: 'GRUP' },
        })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('GRUP')).toBeInTheDocument();
    expect(screen.queryByText('OSUBB')).not.toBeInTheDocument();
  });

  it('renders unread indicator when isRead is false', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ isRead: false })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Necitit')).toBeInTheDocument();
  });

  it('does not render unread indicator when isRead is true', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ isRead: true })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText('Necitit')).not.toBeInTheDocument();
  });

  it('renders external form button with safe attributes when form_url is present', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          formLabel: 'Completează formularul',
          formUrl: 'https://forms.gle/exemplu',
        })}
        onOpen={vi.fn()}
      />,
    );

    const formLink = screen.getByRole('link', {
      name: /Completează formularul/,
    });
    expect(formLink).toBeInTheDocument();
    expect(formLink).toHaveAttribute('href', 'https://forms.gle/exemplu');
    expect(formLink).toHaveAttribute('target', '_blank');
    expect(formLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('calls onOpen when read button is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation();

    render(<AnnouncementCard announcement={item} onOpen={onOpen} />);

    await user.click(screen.getByRole('button', { name: /Citește/ }));
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it('calls onOpen when Citește button is activated via keyboard Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation();

    render(<AnnouncementCard announcement={item} onOpen={onOpen} />);

    const readBtn = screen.getByRole('button', { name: /Citește/ });
    readBtn.focus();
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it('keyboard activation of form link with Enter does not trigger onOpen', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation({
      formLabel: 'Formular',
      formUrl: 'https://forms.gle/test',
    });

    render(<AnnouncementCard announcement={item} onOpen={onOpen} />);

    const formLink = screen.getByRole('link', { name: /Formular/ });
    formLink.focus();
    await user.keyboard('{Enter}');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('clicking form link does not trigger onOpen', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const item = presentation({
      formLabel: 'Formular',
      formUrl: 'https://forms.gle/test',
    });

    render(<AnnouncementCard announcement={item} onOpen={onOpen} />);

    const formLink = screen.getByRole('link', { name: /Formular/ });
    await user.click(formLink);

    expect(onOpen).not.toHaveBeenCalled();
  });
});
