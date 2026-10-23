import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'b0000000-0000-0000-0000-000000000001' } },
    claims: { member_level: 7 },
  }),
}));
// The fields ask for the viewer's capabilities over an RPC of their own; the
// only RPCs this suite counts are the decisions.
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: true }),
}));

import AnnouncementEditSheet from './AnnouncementEditSheet';
import type { AnnouncementPresentation } from './announcements-presentation';

function renderSheet(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

/** A Voluntar's OSUBB-wide Announcement, waiting for BC (spec 2026-10-11). */
function pending(): AnnouncementPresentation {
  return {
    id: 3,
    title: 'Burse',
    body: 'Dosarele se depun până vineri.',
    groupId: 1,
    group: { id: 1, name: 'OSUBB', short: 'OSUBB', isOrganization: true },
    audience: 'org',
    audienceLabel: null,
    authorMember: {
      memberId: 'a0000000-0000-0000-0000-000000000004',
      fullName: 'Ana Pop',
    },
    priority: 'normal',
    pinned: false,
    links: [],
    publishedAt: '2026-10-11T09:00:00.000Z',
    publishedLabel: '11 octombrie 2026, 12:00',
    approvalStatus: 'pending',
    rejectionReason: null,
    deadline: null,
    expired: false,
    minLevel: 0,
    minLevelLabel: null,
    isRead: false,
  };
}

beforeEach(() => {
  resetSupabaseMock();
});

describe('AnnouncementEditSheet in review mode (spec 2026-10-11)', () => {
  it('offers Respinge and Aprobă și publică in place of Salvează', () => {
    renderSheet(
      <AnnouncementEditSheet
        announcement={pending()}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided: vi.fn() }}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Revizuiește anunțul' });
    expect(
      within(sheet).getByRole('button', { name: 'Respinge' }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    ).toBeVisible();
    expect(
      within(sheet).queryByRole('button', { name: 'Salvează modificările' }),
    ).toBeNull();
    // The author stays: the sheet shows whose Announcement BC is reading.
    expect(within(sheet).getByRole('textbox', { name: 'Titlu' })).toHaveValue(
      'Burse',
    );
  });

  it('saves the edits first, then approves, and reports approved', async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    supabaseMock.select.mockResolvedValueOnce({
      data: [{ id: 3 }],
      error: null,
    });
    supabaseMock.rpc.mockResolvedValueOnce({ data: { id: 3 }, error: null });
    renderSheet(
      <AnnouncementEditSheet
        announcement={pending()}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided }}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Revizuiește anunțul' });
    await user.type(
      within(sheet).getByRole('textbox', { name: 'Titlu' }),
      ' Erasmus',
    );
    await user.click(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    );

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('approved'));
    expect(supabaseMock.update).toHaveBeenCalledWith({
      title: 'Burse Erasmus',
    });
    expect(supabaseMock.eq).toHaveBeenCalledWith('id', 3);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('approve_announcement', {
      p_id: 3,
    });
    // The edit lands before the publication, so the organisation reads the
    // corrected text.
    expect(supabaseMock.update.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.rpc.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('approves as it stands when nothing was changed', async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    supabaseMock.rpc.mockResolvedValueOnce({ data: { id: 3 }, error: null });
    renderSheet(
      <AnnouncementEditSheet
        announcement={pending()}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Aprobă și publică' }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('approved'));
    expect(supabaseMock.update).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('approve_announcement', {
      p_id: 3,
    });
  });

  it('rejects only with a written reason, and reports rejected', async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    supabaseMock.rpc.mockResolvedValueOnce({ data: { id: 3 }, error: null });
    renderSheet(
      <AnnouncementEditSheet
        announcement={pending()}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Respinge' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Respinge anunțul',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Respinge' }));
    expect(
      await within(dialog).findByText('Scrie motivul respingerii.'),
    ).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByRole('textbox', { name: 'Motivul respingerii' }),
      'Lipsesc datele de contact.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Respinge' }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('rejected'));
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reject_announcement', {
      p_id: 3,
      p_reason: 'Lipsesc datele de contact.',
    });
    expect(supabaseMock.update).not.toHaveBeenCalled();
  });

  it('shows the refusal when the request was already decided', async () => {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', message: 'announcement_not_pending' },
    });
    renderSheet(
      <AnnouncementEditSheet
        announcement={pending()}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Aprobă și publică' }));

    expect(
      await screen.findByText('Cererea a fost deja decisă.'),
    ).toBeInTheDocument();
    expect(onDecided).not.toHaveBeenCalled();
  });
});
