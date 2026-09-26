import * as axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));

/* Only for the end-to-end restore test below, which renders the real router so
   the front-door guard — not a stand-in — decides where a fresh session lands.
   Everything the guard may route to is stubbed; the login screen itself is
   deliberately NOT stubbed, because it is what is under test. */
vi.mock('../../components/shell/AppShell', async () => {
  const { Outlet } =
    await vi.importActual<typeof import('react-router')>('react-router');
  return { default: () => <Outlet /> };
});
vi.mock('../dashboard/DashboardScreen', () => ({
  default: () => <h1>Dashboard</h1>,
}));
vi.mock('../tracker/TrackerScreen', () => ({ default: () => null }));
vi.mock('../calendar/CalendarScreen', () => ({ default: () => null }));
vi.mock('../requests/CompletedWorkRequestScreen', () => ({
  default: () => <h1>Cereri</h1>,
}));
vi.mock('../no-profile/NoProfileScreen', () => ({
  default: () => <h1>Fără profil</h1>,
}));
vi.mock('../Placeholder', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import App from '../../App';
import { AuthProvider } from '../../lib/auth';
import LoginScreen from './LoginScreen';

type FakeSession = { access_token: string; user: { id: string } };
type AuthListener = (event: string, session: FakeSession | null) => void;

/** A token the real `decodeClaims` accepts: claims live in the token, not on
    `session.user.app_metadata`. Header and signature are never read. */
function memberAccessToken(): string {
  const payload = {
    app_metadata: {
      member_role: 'voluntar',
      member_level: 1,
      group_ids: [],
    },
  };
  const base64url = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${base64url}.signature`;
}

function askForTheEmail(address = 'MEMBRU@EXEMPLU.RO') {
  fireEvent.input(screen.getByLabelText('Email'), {
    target: { value: address },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }));
}

function typeTheCode(code: string) {
  fireEvent.input(screen.getByLabelText('Cod de 6 cifre'), {
    target: { value: code },
  });
}

describe('LoginScreen', () => {
  beforeEach(() => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
  });

  it('starts from the address a failed emailed link handed over (#768)', async () => {
    render(<LoginScreen initialEmail="membru@exemplu.ro" />);

    expect(screen.getByLabelText('Email')).toHaveValue('membru@exemplu.ro');
    fireEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }));

    await waitFor(() =>
      expect(auth.signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'membru@exemplu.ro' }),
      ),
    );
  });

  it('moves focus to the confirmation heading after sending a magic link', async () => {
    render(<LoginScreen />);

    askForTheEmail();

    const heading = await screen.findByRole('heading', {
      name: 'Verifică-ți emailul',
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('offers the code as a second step and verifies it as the same OTP', async () => {
    const { container } = render(<LoginScreen />);

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });

    expect(
      screen.getByText('Apasă linkul din email sau introdu codul de 6 cifre.'),
    ).toBeVisible();
    const field = screen.getByLabelText('Cod de 6 cifre');
    // What makes the code reachable at all on a phone: the OS offers it from
    // the message instead of asking the member to switch apps and memorise it.
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(
      screen.getByRole('button', { name: 'Conectează-mă' }),
    ).toBeDisabled();

    const results = await axe.run(container, {
      // jsdom computes no colors; contrast is covered in a real browser.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);

    typeTheCode('12 34x56');
    expect(field).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    await waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: 'membru@exemplu.ro',
        token: '123456',
        type: 'email',
      }),
    );
    // No second request for a link: the code IS the emailed one-time password.
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('shows a safe message for a wrong code and leaves the form usable', async () => {
    auth.verifyOtp.mockResolvedValue({
      error: { code: 'invalid_token', message: 'Invalid token supplied' },
    });
    render(<LoginScreen />);

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    typeTheCode('000000');
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Linkul de conectare nu este valid. Cere unul nou.',
    );
    expect(screen.queryByText(/Invalid token supplied/i)).toBeNull();
    const field = screen.getByLabelText('Cod de 6 cifre');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Conectează-mă' })).toBeEnabled();
  });

  it('shows a safe message for an expired code', async () => {
    auth.verifyOtp.mockResolvedValue({
      error: {
        code: 'otp_expired',
        message: 'Token has expired or is invalid',
      },
    });
    render(<LoginScreen />);

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    typeTheCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Linkul a expirat sau a fost deja folosit. Cere unul nou.',
    );
  });

  it('reports a thrown verification failure without leaking it', async () => {
    auth.verifyOtp.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LoginScreen />);

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    typeTheCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu te-am putut conecta la internet. Verifică conexiunea și încearcă din nou.',
    );
  });
});

describe('LoginScreen code sign-in, end to end', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('restores the saved destination after a code sign-in', async () => {
    const session: FakeSession = {
      access_token: memberAccessToken(),
      user: { id: 'membru' },
    };
    let notify: AuthListener | undefined;
    auth.onAuthStateChange.mockImplementation((callback: AuthListener) => {
      notify = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    // What supabase-js does on a successful verification: it stores the session
    // and tells every listener, which is how the provider learns about it.
    auth.verifyOtp.mockImplementation(() => {
      notify?.('SIGNED_IN', session);
      return Promise.resolve({ data: { session }, error: null });
    });

    window.history.pushState({}, '', '/cereri');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // The guard parked the destination on the login URL (#537).
    await screen.findByRole('heading', { name: 'Aplicația OSUBB' });
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('next')).toBe(
      '/cereri',
    );

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    typeTheCode('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    await screen.findByRole('heading', { name: 'Cereri' });
    expect(window.location.pathname).toBe('/cereri');
  });
});
