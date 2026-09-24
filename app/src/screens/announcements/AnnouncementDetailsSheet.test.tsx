import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const viewer = vi.hoisted(() => ({
  id: 'd0000000-0000-0000-0000-000000000001',
  bcOrModerator: false,
  groups: [] as { id: number; group_role: string }[],
}));

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: viewer.id } },
  }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: viewer.bcOrModerator }),
}));
vi.mock('../../queries/my-groups', () => ({
  useMyGroupRoles: () => ({ data: viewer.groups }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

import AnnouncementDetailsSheet from './AnnouncementDetailsSheet';

function renderSheet(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  resetSupabaseMock();
  viewer.bcOrModerator = false;
  viewer.groups = [];
});
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

describe('AnnouncementDetailsSheet', () => {
  it('renders nothing when announcement is null', () => {
    const { container } = renderSheet(
      <AnnouncementDetailsSheet announcement={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders neutral fallback badge when department is unresolved and does not label it OSUBB', () => {
    const item = presentation({
      groupId: 99,
      group: { id: 99, name: 'Grup', short: 'GRUP' },
    });

    renderSheet(
      <AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Grup')).toBeInTheDocument();
    expect(screen.queryByText('OSUBB')).not.toBeInTheDocument();
  });

  it('displays full announcement title, body, author, and date', () => {
    const item = presentation();

    renderSheet(
      <AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />,
    );

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

    renderSheet(
      <AnnouncementDetailsSheet announcement={item} onClose={vi.fn()} />,
    );

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

    renderSheet(
      <AnnouncementDetailsSheet announcement={item} onClose={onClose} />,
    );

    await user.click(screen.getByRole('button', { name: 'Închide' }));
    expect(onClose).toHaveBeenCalled();
  });
  describe('author and readers (R15)', () => {
    const author = {
      memberId: viewer.id,
      nickname: 'Ani',
      fullName: 'Ana Pop',
    };

    function answerReaders() {
      supabaseMock.rpc.mockResolvedValue({
        data: [
          { member_id: 'r1', read_at: '2026-09-20T09:30:00.000Z' },
          { member_id: 'r2', read_at: null },
        ],
        error: null,
      });
      supabaseMock.select.mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'r1',
              full_name: 'Radu Ilie',
              nickname: 'Radu',
              avatar_color: null,
            },
            {
              id: 'r2',
              full_name: 'Dana Moldovan',
              nickname: null,
              avatar_color: null,
            },
          ],
          error: null,
        }),
      });
    }

    it('names the author as a Member Card button', async () => {
      const user = userEvent.setup();
      supabaseMock.rpc.mockResolvedValue({ data: [], error: null });
      renderSheet(
        <AnnouncementDetailsSheet
          announcement={presentation({ authorMember: author })}
          onClose={vi.fn()}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'Profilul membrului Ani' }),
      );
      expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
    });

    it('shows the author "Citit de x din y" and a dialog of readers, then the unread, each a Member Card button', async () => {
      const user = userEvent.setup();
      answerReaders();
      renderSheet(
        <AnnouncementDetailsSheet
          announcement={presentation({ authorMember: author })}
          onClose={vi.fn()}
        />,
      );

      expect(await screen.findByText('Citit de 1 din 2')).toBeInTheDocument();
      expect(supabaseMock.rpc).toHaveBeenCalledWith('announcement_readers', {
        p_announcement_id: 1,
      });

      await user.click(
        screen.getByRole('button', { name: 'Vezi cine a citit' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Cine a citit',
      });
      const read = within(dialog).getByRole('region', { name: 'Au citit (1)' });
      expect(
        within(read).getByRole('button', { name: 'Profilul membrului Radu' }),
      ).toBeInTheDocument();
      expect(read).toHaveTextContent('20 septembrie 2026, 12:30');
      const unread = within(dialog).getByRole('region', {
        name: 'Nu au citit încă (1)',
      });
      await user.click(
        within(unread).getByRole('button', {
          name: 'Profilul membrului Dana Moldovan',
        }),
      );
      expect(
        await screen.findByRole('dialog', { name: 'Dana Moldovan' }),
      ).toBeVisible();
    });

    it('asks for a BC/Moderator and hides the line silently on PT404', async () => {
      viewer.bcOrModerator = true;
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: { code: 'PT404', message: 'announcement_not_found' },
      });
      renderSheet(
        <AnnouncementDetailsSheet
          announcement={presentation({
            authorMember: { memberId: 'someone-else', fullName: 'Ana Pop' },
          })}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() =>
        expect(supabaseMock.rpc).toHaveBeenCalledWith('announcement_readers', {
          p_announcement_id: 1,
        }),
      );
      expect(screen.queryByText(/Citit de/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Vezi cine a citit' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Nu am putut/)).not.toBeInTheDocument();
    });

    it("asks for a Manager of a local Announcement's Origin", async () => {
      viewer.groups = [{ id: 1, group_role: 'manager' }];
      answerReaders();
      renderSheet(
        <AnnouncementDetailsSheet
          announcement={presentation({
            audience: 'local',
            authorMember: { memberId: 'someone-else', fullName: 'Ana Pop' },
          })}
          onClose={vi.fn()}
        />,
      );

      expect(await screen.findByText('Citit de 1 din 2')).toBeInTheDocument();
    });

    it('never asks for an ordinary Member', () => {
      renderSheet(
        <AnnouncementDetailsSheet
          announcement={presentation({
            audience: 'local',
            authorMember: { memberId: 'someone-else', fullName: 'Ana Pop' },
          })}
          onClose={vi.fn()}
        />,
      );

      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(screen.queryByText(/Citit de/)).not.toBeInTheDocument();
    });
  });
});
