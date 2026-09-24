import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

const MEMBER = vi.hoisted(() => '63500000-0000-4000-8000-000000000001');
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));

import { PushPreferences } from './PushPreferences';

function renderPreferences() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <PushPreferences />
    </QueryClientProvider>,
  );
}

function theSwitch(name: string) {
  return screen.getByRole('switch', { name });
}

/** The first read has landed: the switch is enabled and can be clicked. */
async function ready(name: string) {
  await waitFor(() =>
    expect(theSwitch(name)).not.toHaveAttribute('aria-disabled', 'true'),
  );
}

describe('PushPreferences', () => {
  beforeEach(() => {
    resetSupabaseMock();
    // The read: `from().select().eq('member_id', …)`.
    supabaseMock.eq.mockResolvedValue({
      data: [{ kind: 'event', push_enabled: false }],
      error: null,
    });
    supabaseMock.upsert.mockResolvedValue({ data: null, error: null });
  });

  it("reads the Member's rows, with an absent row meaning on", async () => {
    const { container } = renderPreferences();

    await waitFor(() => expect(theSwitch('Evenimente')).not.toBeChecked());
    expect(theSwitch('Anunțuri')).toBeChecked();
    expect(theSwitch('Termene limită')).toBeChecked();
    expect(supabaseMock.from).toHaveBeenCalledWith(
      'notification_push_preferences',
    );
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', MEMBER);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('offers no switch for Tasks or system Notifications', async () => {
    renderPreferences();
    await waitFor(() => expect(theSwitch('Evenimente')).not.toBeChecked());
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('names the three kinds that always arrive', () => {
    renderPreferences();
    expect(
      screen.getByText(
        'Ajung mereu: notificările despre Taskuri, cele de sistem și anunțurile critice.',
      ),
    ).toBeVisible();
  });

  it('turning a switch off writes the preference for the Member', async () => {
    // The server now holds the new row; the refetch after the write reads it.
    supabaseMock.upsert.mockImplementation(async () => {
      supabaseMock.eq.mockResolvedValue({
        data: [
          { kind: 'event', push_enabled: false },
          { kind: 'announce', push_enabled: false },
        ],
        error: null,
      });
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    renderPreferences();
    await ready('Anunțuri');
    expect(theSwitch('Anunțuri')).toBeChecked();

    await user.click(theSwitch('Anunțuri'));

    expect(supabaseMock.upsert).toHaveBeenCalledWith(
      { member_id: MEMBER, kind: 'announce', push_enabled: false },
      { onConflict: 'member_id,kind' },
    );
    expect(theSwitch('Anunțuri')).not.toBeChecked();
  });

  it('turning a switch back on writes push_enabled true', async () => {
    const user = userEvent.setup();
    renderPreferences();
    await waitFor(() => expect(theSwitch('Evenimente')).not.toBeChecked());

    await user.click(theSwitch('Evenimente'));

    expect(supabaseMock.upsert).toHaveBeenCalledWith(
      { member_id: MEMBER, kind: 'event', push_enabled: true },
      { onConflict: 'member_id,kind' },
    );
  });

  it('holds every switch while one write is in flight', async () => {
    let finish: (value: { data: null; error: null }) => void = () => {};
    supabaseMock.upsert.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPreferences();
    await ready('Anunțuri');
    expect(theSwitch('Anunțuri')).toBeChecked();

    await user.click(theSwitch('Anunțuri'));

    for (const name of ['Anunțuri', 'Evenimente', 'Termene limită']) {
      expect(theSwitch(name)).toHaveAttribute('aria-disabled', 'true');
    }
    await user.click(theSwitch('Evenimente'));
    expect(supabaseMock.upsert).toHaveBeenCalledTimes(1);

    finish({ data: null, error: null });
    await waitFor(() =>
      expect(theSwitch('Evenimente')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
  });

  it('keeps every switch held when the first read fails', async () => {
    supabaseMock.eq.mockResolvedValue({
      data: null,
      error: { message: 'network down' },
    });
    renderPreferences();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut încărca preferințele. Verifică internetul și reîncarcă pagina.',
    );
    for (const name of ['Anunțuri', 'Evenimente', 'Termene limită']) {
      expect(theSwitch(name)).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('puts the switch back and says so in Romanian when the write fails', async () => {
    supabaseMock.upsert.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    const user = userEvent.setup();
    renderPreferences();
    await ready('Termene limită');
    expect(theSwitch('Termene limită')).toBeChecked();

    await user.click(theSwitch('Termene limită'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut salva preferința. Verifică internetul și încearcă din nou.',
    );
    await ready('Termene limită');
    expect(theSwitch('Termene limită')).toBeChecked();
  });
});
