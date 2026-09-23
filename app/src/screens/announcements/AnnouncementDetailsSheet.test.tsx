import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AnnouncementDetailsSheet from './AnnouncementDetailsSheet';
import type { AnnouncementPresentation } from './announcements-presentation';

function presentation(
  overrides: Partial<AnnouncementPresentation> = {},
): AnnouncementPresentation {
  return {
    id: 1,
    title: 'Ședință extraordinară BC',
    body: 'Vineri la ora 18:00 în Aula Magna.\nPrezența tuturor coordonatorilor este obligatorie.',
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

describe('AnnouncementDetailsSheet', () => {
  it('renders nothing when announcement is null', () => {
    const { container } = render(
      <AnnouncementDetailsSheet announcement={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders neutral fallback badge when department is unresolved and does not label it OSUBB', () => {
    const item = presentation({
      groupId: 99,
      group: { id: 99, name: 'Grup', short: 'GRUP' },
    });

    render(<AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />);

    expect(screen.getByText('Grup')).toBeInTheDocument();
    expect(screen.queryByText('OSUBB')).not.toBeInTheDocument();
  });

  it('displays full announcement title, body, author, and date', () => {
    const item = presentation();

    render(<AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Detalii anunț' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ședință extraordinară BC')).toBeInTheDocument();
    expect(
      screen.getByText(/Vineri la ora 18:00 în Aula Magna/),
    ).toBeInTheDocument();
    expect(screen.getByText('BC')).toBeInTheDocument();
    expect(screen.getByText(/18 septembrie 2026/)).toBeInTheDocument();
  });

  it('renders form link when formLabel and formUrl are present', () => {
    const item = presentation({
      formLabel: 'Feedback formular',
      formUrl: 'https://forms.gle/feedback',
    });

    render(<AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />);

    const formLink = screen.getByRole('link', {
      name: /Deschide formular: Feedback formular/,
    });
    expect(formLink).toBeInTheDocument();
    expect(formLink).toHaveAttribute('href', 'https://forms.gle/feedback');
    expect(formLink).toHaveAttribute('target', '_blank');
    expect(formLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const item = presentation();

    render(<AnnouncementDetailsSheet announcement={item} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Închide' }));
    expect(onClose).toHaveBeenCalled();
  });
});
