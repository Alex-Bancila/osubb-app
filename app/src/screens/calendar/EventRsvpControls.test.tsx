import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));

import EventRsvpControls from './EventRsvpControls';

const memberId = 'a1000000-0000-0000-0000-000000000238';

type Row = {
  event_id: number;
  member_id: string;
  status: 'going' | 'declined';
  checked_in: boolean;
};

/** The server's one answer for this member and Event (null: none yet). */
let stored: Row | null;

function row(status: Row['status']): Row {
  return { event_id: 7, member_id: memberId, status, checked_in: false };
}

/** An RPC reply held until the test lets it go. */
function deferredRpc() {
  let release: (status: Row['status']) => void = () => {};
  supabaseMock.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = (status) => {
          stored = row(status);
          resolve({ data: stored, error: null });
        };
      }),
  );
  return (status: Row['status']) => release(status);
}

function renderControls() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EventRsvpControls eventId={7} eventTitle="Ședință BC" />
    </QueryClientProvider>,
  );
}

function answer(name: 'Particip' | 'Nu particip'): HTMLElement {
  return screen.getByRole('button', { name });
}

function receipt(): HTMLElement {
  return screen.getByRole('status');
}

async function loaded() {
  await waitFor(() =>
    expect(answer('Particip')).not.toHaveAttribute('aria-disabled', 'true'),
  );
}

describe('EventRsvpControls', () => {
  beforeEach(() => {
    resetSupabaseMock();
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    stored = row('going');
    supabaseMock.maybeSingle.mockImplementation(() =>
      Promise.resolve({ data: stored, error: null }),
    );
    supabaseMock.rpc.mockImplementation(
      (_name: string, args: { p_status: Row['status'] }) => {
        stored = row(args.p_status);
        return Promise.resolve({ data: stored, error: null });
      },
    );
  });

  it('shows the saved answer as a chosen button, and nothing else at rest', async () => {
    renderControls();
    await loaded();

    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'true');
    expect(answer('Particip')).toHaveClass('bg-primary');
    expect(answer('Particip').querySelector('svg')).not.toBeNull();
    expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'false');
    expect(answer('Nu particip').querySelector('svg')).toBeNull();
    expect(receipt()).toBeEmptyDOMElement();
  });

  it('fills a chosen "Nu particip" in ink, apart from the red "Particip"', async () => {
    stored = row('declined');
    renderControls();
    await loaded();

    expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'true');
    expect(answer('Nu particip')).toHaveClass(
      'bg-foreground',
      'text-background',
    );
    expect(answer('Nu particip')).not.toHaveClass('bg-primary');
    expect(answer('Particip')).not.toHaveClass('bg-primary');
    expect(answer('Particip')).not.toHaveClass('bg-foreground');
  });

  it('sends nothing when the chosen answer is clicked again, and says so', async () => {
    const user = userEvent.setup();
    renderControls();
    await loaded();

    await user.click(answer('Particip'));
    await user.click(answer('Particip'));

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(receipt()).toHaveTextContent(
      'Participarea ta este deja confirmată.',
    );
    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends exactly one request for a different answer, however fast the taps', async () => {
    const user = userEvent.setup();
    const release = deferredRpc();
    renderControls();
    await loaded();

    await user.click(answer('Nu particip'));
    await user.click(answer('Nu particip'));
    await user.click(answer('Particip'));
    release('declined');

    await waitFor(() => expect(receipt()).toHaveTextContent(/nu participi/));
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_event_rsvp', {
      p_event_id: 7,
      p_status: 'declined',
    });
  });

  it('flips the choice at once and disables both answers while it saves', async () => {
    const user = userEvent.setup();
    const release = deferredRpc();
    renderControls();
    await loaded();

    await user.click(answer('Nu particip'));

    // Optimistic: the new answer is the chosen one before the server replies.
    await waitFor(() =>
      expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'false');
    expect(answer('Particip')).toHaveAttribute('aria-disabled', 'true');
    expect(answer('Nu particip')).toHaveAttribute('aria-disabled', 'true');
    expect(answer('Nu particip').querySelector('.animate-spin')).not.toBeNull();
    expect(
      screen.getByRole('group', { name: 'Alege răspunsul' }),
    ).toHaveAttribute('aria-busy', 'true');
    // Focus stays on the tapped button rather than falling to the page.
    expect(answer('Nu particip')).toHaveFocus();

    release('declined');
    await waitFor(() =>
      expect(answer('Nu particip')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
  });

  it('shows a visible receipt naming the Event after a save', async () => {
    const user = userEvent.setup();
    renderControls();
    await loaded();

    await user.click(answer('Nu particip'));

    await waitFor(() =>
      expect(receipt()).toHaveTextContent(
        'Ai anunțat că nu participi la „Ședință BC”.',
      ),
    );
    // Seen, not only announced (the old line was `sr-only`).
    expect(within(receipt()).queryByText(/nu participi/)).not.toHaveClass(
      'sr-only',
    );
    expect(receipt()).not.toHaveClass('sr-only');
    expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'true');

    await user.click(answer('Particip'));
    await waitFor(() =>
      expect(receipt()).toHaveTextContent(
        'Ai confirmat participarea la „Ședință BC”.',
      ),
    );
  });

  it('confirms a first answer to an Event never answered', async () => {
    const user = userEvent.setup();
    stored = null;
    renderControls();
    await loaded();
    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'false');
    expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'false');

    await user.click(answer('Particip'));

    await waitFor(() =>
      expect(receipt()).toHaveTextContent(
        'Ai confirmat participarea la „Ședință BC”.',
      ),
    );
    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the failure and puts the earlier answer back', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    renderControls();
    await loaded();

    await user.click(answer('Nu particip'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea să răspunzi la acest eveniment.',
    );
    expect(answer('Particip')).toHaveAttribute('aria-pressed', 'true');
    expect(answer('Nu particip')).toHaveAttribute('aria-pressed', 'false');
    expect(receipt()).not.toHaveTextContent(/Ai anunțat/);
  });
});
