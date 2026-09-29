import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

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
    group: { id: 1, name: 'OSUBB', short: 'OSUBB', isOrganization: true },
    audience: 'org',
    audienceLabel: null,
    author: 'BC',
    authorMember: null,
    priority: 'critical',
    category: 'organizatoric',
    pinned: true,
    formLabel: null,
    formUrl: null,
    publishedAt: '2026-09-18T15:00:00.000Z',
    publishedLabel: '18 septembrie 2026, 18:00',
    deadline: null,
    minLevel: 0,
    minLevelLabel: null,
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

    // B34: the Group's name, never its short code.
    expect(screen.queryByText('EDU')).not.toBeInTheDocument();
    const deptBadge = screen.getByText('Educațional');
    expect(deptBadge).toBeInTheDocument();
    expect(deptBadge).toHaveStyle({ backgroundColor: '#284C93' });
  });

  it('names the Organization Group "OSUBB" and shows no organization-wide Audience', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          group: {
            id: 5,
            name: 'Organizația',
            short: 'ORG',
            isOrganization: true,
          },
          audience: 'org',
          audienceLabel: null,
        })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('OSUBB')).toBeInTheDocument();
    expect(screen.queryByText('ORG')).not.toBeInTheDocument();
    expect(screen.queryByText('Toată organizația')).not.toBeInTheDocument();
  });

  it('shows a local Audience by the Group name', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          group: { id: 2, name: 'Educațional', short: 'EDU' },
          audience: 'local',
          audienceLabel: 'Doar Educațional',
        })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Doar Educațional')).toBeInTheDocument();
  });

  it('shows no priority chip for a Normal Announcement', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ priority: 'normal' })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    expect(screen.queryByText('Critic')).not.toBeInTheDocument();
  });

  it('keeps one meta line before the title, the date under it and one footer row (N1)', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ category: 'organizatoric' })}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole('article');
    const title = screen.getByRole('heading', {
      name: 'Ședință extraordinară BC',
    });
    const content = title.parentElement as HTMLElement;
    // Only the meta line comes before the title, and the date follows it.
    expect(title.previousElementSibling).toHaveAttribute(
      'data-slot',
      'announcement-meta',
    );
    expect(title.previousElementSibling?.previousElementSibling).toBeNull();
    expect(title.nextElementSibling?.tagName).toBe('TIME');
    expect(
      content.querySelectorAll('[data-slot=announcement-meta]'),
    ).toHaveLength(1);
    // The category stays in the details sheet.
    expect(screen.queryByText('organizatoric')).not.toBeInTheDocument();
    const footer = card.querySelector('[data-slot=card-footer]') as HTMLElement;
    expect(footer).toHaveTextContent('BC');
    expect(footer).toContainElement(
      screen.getByRole('button', { name: /Citește/ }),
    );
    expect(footer).not.toHaveTextContent('18 septembrie');
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

    expect(screen.getByText('Grup')).toBeInTheDocument();
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

  it('renders the Attached Link button with safe attributes when form_url is present', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          formLabel: 'Completează formularul',
          formUrl: 'https://forms.gle/exemplu',
        })}
        onOpen={vi.fn()}
      />,
    );

    // AttachedLinkButton's own accessible name (#679): the label plus the
    // new-tab hint, not the card's old "Deschide formular:" prefix.
    const formLink = screen.getByRole('link', {
      name: 'Completează formularul (se deschide într-o filă nouă)',
    });
    expect(formLink).toBeInTheDocument();
    expect(formLink).toHaveAttribute('href', 'https://forms.gle/exemplu');
    expect(formLink).toHaveAttribute('target', '_blank');
    expect(formLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no Attached Link button when form_url is absent', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ formLabel: null, formUrl: null })}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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

  it('names the author as a Member Card button that does not open the Announcement', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <AnnouncementCard
        announcement={presentation({
          authorMember: {
            memberId: 'm1',
            nickname: 'Ani',
            fullName: 'Ana Pop',
          },
        })}
        onOpen={onOpen}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Profilul membrului Ani' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('the Termen on the card (#909)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  const termen = () =>
    document.querySelector('[data-slot="announcement-termen"]');

  it('shows no Termen row when the Announcement has none', () => {
    render(<AnnouncementCard announcement={presentation()} onOpen={vi.fn()} />);
    expect(termen()).toBeNull();
  });

  it('shows a later Termen on its own row, apart from the meta line', () => {
    at('2026-09-29T09:00:00.000Z');
    render(
      <AnnouncementCard
        announcement={presentation({ deadline: '2026-10-02T20:59:00.000Z' })}
        onOpen={vi.fn()}
      />,
    );
    expect(termen()).toHaveAttribute('data-state', 'upcoming');
    expect(termen()).toHaveTextContent('Termen:vineri, 2 octombrie, 23:59');
    expect(termen()?.closest('[data-slot="announcement-meta"]')).toBeNull();
    expect(termen()?.className).toMatch('border-l-');
  });

  it('emphasises a Termen within 48 hours', () => {
    at('2026-09-29T09:00:00.000Z');
    render(
      <AnnouncementCard
        announcement={presentation({ deadline: '2026-09-30T15:40:00.000Z' })}
        onOpen={vi.fn()}
      />,
    );
    expect(termen()).toHaveAttribute('data-state', 'soon');
    expect(termen()).toHaveTextContent('mâine, 18:40');
    expect(termen()?.className).toMatch('bg-primary');
  });

  it('reads "Termen expirat" in a muted tone once it has passed', () => {
    at('2026-10-05T09:00:00.000Z');
    render(
      <AnnouncementCard
        announcement={presentation({ deadline: '2026-10-02T20:59:00.000Z' })}
        onOpen={vi.fn()}
      />,
    );
    expect(termen()).toHaveAttribute('data-state', 'expired');
    expect(termen()).toHaveTextContent('Termen expirat');
    expect(termen()?.className).toMatch('text-muted-foreground');
  });
});

describe('the Minimum Level on the card (#909)', () => {
  it('shows it in the meta line only above Recrut', () => {
    const { unmount } = render(
      <AnnouncementCard
        announcement={presentation({
          minLevel: 2,
          minLevelLabel: 'Nivel minim: Voluntar Activ',
        })}
        onOpen={vi.fn()}
      />,
    );
    const meta = document.querySelector('[data-slot="announcement-meta"]');
    expect(meta).toHaveTextContent('Nivel minim: Voluntar Activ');
    unmount();
    render(<AnnouncementCard announcement={presentation()} onOpen={vi.fn()} />);
    expect(screen.queryByText(/Nivel minim/)).toBeNull();
  });
});
