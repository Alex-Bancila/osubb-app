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
    authorMember: null,
    priority: 'critical',
    pinned: true,
    links: [],
    publishedAt: '2026-09-18T15:00:00.000Z',
    publishedLabel: '18 sept. · 18:00',
    approvalStatus: 'approved',
    rejectionReason: null,
    deadline: null,
    expired: false,
    minLevel: 0,
    minLevelLabel: null,
    isRead: false,
    ...overrides,
  };
}

describe('AnnouncementCard', () => {
  it('renders title, body and formatted date', () => {
    render(<AnnouncementCard announcement={presentation()} onOpen={vi.fn()} />);

    expect(screen.getByText('Ședință extraordinară BC')).toBeInTheDocument();
    expect(
      screen.getByText(/Vineri la ora 18:00 în Aula Magna/),
    ).toBeInTheDocument();
    expect(screen.getByText('18 sept. · 18:00')).toBeInTheDocument();
  });

  it('previews the body as Formatted Text on its three lines: styles kept, blocks run on (R60)', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          body: '# Ordinea de zi\nNe vedem **joi** pe [site](https://osubb.ro).\n\n- unu\n- doi',
        })}
        onOpen={vi.fn()}
      />,
    );

    const preview = document.querySelector('.formatted-text-preview');
    expect(preview).toHaveTextContent(
      'Ordinea de zi · Ne vedem joi pe site. · unu · doi',
    );
    expect(preview?.querySelector('strong')).toHaveTextContent('joi');
    // The card is the tap target: no list, no heading, no link inside it.
    expect(preview?.querySelector('li, h3, h4, a')).toBeNull();
    // Still the one clamped paragraph.
    expect(preview?.parentElement).toHaveClass('line-clamp-3');
    expect(preview?.parentElement?.tagName).toBe('P');
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

  it('keeps one meta line before the title, and the author with the date on one line under it (N1)', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          authorMember: {
            memberId: 'd0000000-0000-0000-0000-000000000007',
            fullName: 'Cristina Șerban',
          },
        })}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole('article', {
      name: 'Ședință extraordinară BC',
    });
    const title = screen.getByRole('heading', { level: 3 });
    const content = title.parentElement as HTMLElement;
    // Only the meta line comes before the title; the author and the date
    // share the one line after it.
    expect(title.previousElementSibling).toHaveAttribute(
      'data-slot',
      'announcement-meta',
    );
    expect(title.previousElementSibling?.previousElementSibling).toBeNull();
    const byline = title.nextElementSibling as HTMLElement;
    expect(byline).toHaveAttribute('data-slot', 'announcement-byline');
    expect(byline).toHaveTextContent('Cristina Șerban·18 sept. · 18:00');
    expect(byline.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-09-18T15:00:00.000Z',
    );
    expect(
      content.querySelectorAll('[data-slot=announcement-meta]'),
    ).toHaveLength(1);
    // No footer row, and no second "Citește": the title opens the card.
    expect(card.querySelector('[data-slot=card-footer]')).toBeNull();
    expect(screen.getByRole('button', { name: /Citește/ })).toBe(
      title.querySelector('button'),
    );
  });

  it('makes the whole card the tap target of its title, with the author and the links above it', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          authorMember: { memberId: 'm1', fullName: 'Ana Pop' },
          links: [{ label: 'Formular', url: 'https://forms.gle/test' }],
        })}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole('article');
    expect(card).toHaveClass('relative');
    const open = screen.getByRole('button', {
      name: 'Citește anunțul Ședință extraordinară BC',
    });
    expect(open).toHaveClass('after:absolute', 'after:inset-0');
    // Nothing between the button and the card is positioned, so the hit
    // area is the card's box.
    for (
      let parent = open.parentElement;
      parent && parent !== card;
      parent = parent.parentElement
    )
      expect(parent.className).not.toMatch(/\b(relative|absolute)\b/);
    expect(
      screen.getByRole('button', { name: 'Profilul membrului Ana Pop' }),
    ).toHaveClass('relative', 'z-1');
    expect(screen.getByRole('link', { name: /Formular/ })).toHaveClass(
      'relative',
      'z-1',
    );
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

  it('renders every Attached Link as a bare-label button with safe attributes (R46)', () => {
    render(
      <AnnouncementCard
        announcement={presentation({
          links: [
            {
              label: 'Completează formularul',
              url: 'https://forms.gle/exemplu',
            },
            { label: 'Program', url: 'https://osubb.ro/program' },
          ],
        })}
        onOpen={vi.fn()}
      />,
    );

    // AttachedLinkButton's own accessible name (#679): the label plus the
    // new-tab hint; a card shows the bare label, never "Deschide".
    const formLink = screen.getByRole('link', {
      name: 'Completează formularul (se deschide într-o filă nouă)',
    });
    expect(formLink).toHaveAttribute('href', 'https://forms.gle/exemplu');
    expect(formLink).toHaveAttribute('target', '_blank');
    expect(formLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByRole('link', {
        name: 'Program (se deschide într-o filă nouă)',
      }),
    ).toHaveAttribute('href', 'https://osubb.ro/program');
    expect(screen.queryByText(/Deschide/)).toBeNull();
  });

  it('renders no Attached Link button when there are no links', () => {
    render(
      <AnnouncementCard
        announcement={presentation({ links: [] })}
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
      links: [{ label: 'Formular', url: 'https://forms.gle/test' }],
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
      links: [{ label: 'Formular', url: 'https://forms.gle/test' }],
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
    expect(termen()).toHaveTextContent('Termen:vin., 2 oct. · 23:59');
    expect(termen()?.closest('[data-slot="announcement-meta"]')).toBeNull();
    // A plain icon line in the meta tone: no bar, no fill.
    expect(termen()?.querySelector('svg')).not.toBeNull();
    expect(termen()?.className).toMatch('text-muted-foreground');
    expect(termen()?.className).not.toMatch(/border-l-|bg-/);
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
    expect(termen()).toHaveTextContent('mâine · 18:40');
    expect(termen()?.className).toMatch('text-destructive');
    expect(termen()?.className).not.toMatch(/bg-/);
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

describe('AnnouncementCard — approval (spec 2026-10-11)', () => {
  it('says În așteptare on a pending Announcement, Respins on a rejected one, nothing once approved', () => {
    const pending = render(
      <AnnouncementCard
        announcement={presentation({ approvalStatus: 'pending' })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('În așteptare')).toBeInTheDocument();
    pending.unmount();

    const rejected = render(
      <AnnouncementCard
        announcement={presentation({
          approvalStatus: 'rejected',
          rejectionReason: 'Lipsesc datele de contact.',
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Respins')).toBeInTheDocument();
    rejected.unmount();

    render(<AnnouncementCard announcement={presentation()} onOpen={vi.fn()} />);
    expect(screen.queryByText('În așteptare')).toBeNull();
    expect(screen.queryByText('Respins')).toBeNull();
  });
});
