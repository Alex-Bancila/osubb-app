import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

const MEMBER = vi.hoisted(() => '77500000-0000-4000-8000-000000000001');
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));

import { EmailDigestCard } from './EmailDigestCard';

function renderCard(path = '/profil') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <EmailDigestCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function theSwitch() {
  return screen.getByRole('switch', { name: 'Rezumat zilnic pe email' });
}

async function ready() {
  await waitFor(() =>
    expect(theSwitch()).not.toHaveAttribute('aria-disabled', 'true'),
  );
}

describe('EmailDigestCard', () => {
  beforeEach(() => {
    resetSupabaseMock();
    // The read: `from().select().eq('member_id', …).maybeSingle()`.
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });
    supabaseMock.upsert.mockResolvedValue({ data: null, error: null });
  });

  it('is off when the Member never turned it on', async () => {
    const { container } = renderCard();
    await ready();
    expect(theSwitch()).not.toBeChecked();
    expect(
      screen.getByText('Nu primești emailuri cu notificările necitite.'),
    ).toBeVisible();
    expect(supabaseMock.from).toHaveBeenCalledWith(
      'notification_email_preferences',
    );
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', MEMBER);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("reads the Member's own row", async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: { digest_enabled: true },
      error: null,
    });
    renderCard();
    await waitFor(() => expect(theSwitch()).toBeChecked());
    expect(
      screen.getByText(
        'Primești dimineața, la 7, un email cu notificările necitite.',
      ),
    ).toBeVisible();
  });

  it('turning it on writes the preference for the Member', async () => {
    // The server now holds the row; the refetch after the write reads it.
    supabaseMock.upsert.mockImplementation(async () => {
      supabaseMock.maybeSingle.mockResolvedValue({
        data: { digest_enabled: true },
        error: null,
      });
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    renderCard();
    await ready();

    await user.click(theSwitch());

    expect(supabaseMock.upsert).toHaveBeenCalledWith(
      { member_id: MEMBER, digest_enabled: true },
      { onConflict: 'member_id' },
    );
    expect(theSwitch()).toBeChecked();
  });

  it('turning it off is the opt-out: it writes digest_enabled false', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: { digest_enabled: true },
      error: null,
    });
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(theSwitch()).toBeChecked());

    await user.click(theSwitch());

    expect(supabaseMock.upsert).toHaveBeenCalledWith(
      { member_id: MEMBER, digest_enabled: false },
      { onConflict: 'member_id' },
    );
  });

  it('puts the switch back and says so in Romanian when the write fails', async () => {
    supabaseMock.upsert.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    const user = userEvent.setup();
    renderCard();
    await ready();

    await user.click(theSwitch());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut salva preferința. Verifică internetul și încearcă din nou.',
    );
    await ready();
    expect(theSwitch()).not.toBeChecked();
  });

  it('keeps the switch held when the read fails', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'network down' },
    });
    renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut încărca preferința. Verifică internetul și reîncarcă pagina.',
    );
    expect(theSwitch()).toHaveAttribute('aria-disabled', 'true');
  });

  it("is the anchor of the email's opt-out link, scrolled into view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderCard('/profil#rezumat-email');
    expect(screen.getByTestId('email-digest-card')).toHaveAttribute(
      'id',
      'rezumat-email',
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
