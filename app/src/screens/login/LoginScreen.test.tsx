import * as axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));
// #968: the login page re-sends an unconfirmed invitation through the
// request-invitation Edge Function.
const functions = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth, functions } }));

/* Only for the end-to-end restore test below, which renders the real router so
   the front-door guard — not a stand-in — decides where a fresh session lands.
   Everything the guard may route to is stubbed; the login screen itself is
   deliberately NOT stubbed, because it is what is under test. */
vi.mock('../../components/shell/AppShell', async () => {
  const { Outlet } =
    await vi.importActual<typeof import('react-router')>('react-router');
  return { default: () => <Outlet /> };
});
// The Privacy Acknowledgement step (#771) has its own tests.
vi.mock('../../components/shell/PrivacyGate', () => ({
  PrivacyGate: ({ children }: { children: ReactElement }) => children,
}));
vi.mock('../dashboard/DashboardScreen', () => ({
  default: () => <h1>Dashboard</h1>,
}));
vi.mock('../tracker/TrackerScreen', () => ({
  default: () => <h1>Taskuri</h1>,
}));
vi.mock('../calendar/CalendarScreen', () => ({ default: () => null }));
vi.mock('../no-profile/NoProfileScreen', () => ({
  default: () => <h1>Fără profil</h1>,
}));
vi.mock('../Placeholder', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import App from '../../App';
import { AuthProvider } from '../../lib/auth';
import LoginScreen from './LoginScreen';
import { requestedSignInFor } from '../../lib/sign-in-request';

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

  it('remembers the address it asked a link for, so /auth/confirm can match it (audit F3)', async () => {
    localStorage.clear();
    render(<LoginScreen initialEmail="Membru@Exemplu.ro" />);
    fireEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }));

    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalled());
    expect(requestedSignInFor('membru@exemplu.ro')).toBe(true);
    expect(requestedSignInFor('altcineva@exemplu.ro')).toBe(false);
  });

  it('links the Privacy Notice from the footer, before and after sending (#771)', async () => {
    render(<LoginScreen />);
    expect(
      screen.getByRole('link', { name: 'Politica de confidențialitate' }),
    ).toHaveAttribute('href', '/confidentialitate');

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    expect(
      screen.getByRole('link', { name: 'Politica de confidențialitate' }),
    ).toHaveAttribute('href', '/confidentialitate');
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

    // A code, not a link (Audit D-14).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Codul este greșit sau a expirat. Verifică-l sau cere unul nou.',
    );
    expect(screen.queryByText(/Invalid token supplied/i)).toBeNull();
    const field = screen.getByLabelText('Cod de 6 cifre');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Conectează-mă' })).toBeEnabled();
  });

  /* Audit D-14: going back must not drop focus to body. */
  it('moves focus to the address field after "Încearcă altă adresă"', async () => {
    render(<LoginScreen />);

    askForTheEmail();
    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Încearcă altă adresă' }),
    );

    expect(await screen.findByLabelText('Email')).toHaveFocus();
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
      'Codul este greșit sau a expirat. Verifică-l sau cere unul nou.',
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

/** Auth's answer to a magic-link request it refuses, as supabase-js hands it over. */
function authRefusal(code: string, message: string) {
  return { data: {}, error: { code, message, status: 422 } };
}

/** A non-2xx answer from the Edge Function: its Response inside the error. */
function functionRefusal(status: number, body = '{}') {
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx'), {
      context: new Response(body, { status }),
    }),
  };
}

describe('LoginScreen re-sends an unconfirmed invitation (#968)', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.signInWithOtp.mockReset();
    functions.invoke.mockReset();
    functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('asks the function to re-send on signup_disabled, then shows the sent screen with the code step', async () => {
    auth.signInWithOtp.mockResolvedValue(
      authRefusal('signup_disabled', 'Signups not allowed for this instance'),
    );
    render(<LoginScreen />);

    askForTheEmail();

    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    expect(functions.invoke).toHaveBeenCalledTimes(1);
    expect(functions.invoke).toHaveBeenCalledWith('request-invitation', {
      body: { email: 'membru@exemplu.ro' },
    });
    // The invitation's six-digit code is the same Sign-in Code.
    expect(screen.getByLabelText('Cod de 6 cifre')).toBeVisible();
    // Remembered before the call, so /auth/confirm signs in without asking.
    expect(requestedSignInFor('membru@exemplu.ro')).toBe(true);
  });

  it('shows the sent screen on otp_disabled without asking the function — an unknown address learns nothing', async () => {
    auth.signInWithOtp.mockResolvedValue(
      authRefusal('otp_disabled', 'Signups not allowed for otp'),
    );
    render(<LoginScreen />);

    askForTheEmail();

    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('shows the rate-limit copy when the function answers 429, never the sent screen', async () => {
    auth.signInWithOtp.mockResolvedValue(
      authRefusal('signup_disabled', 'Signups not allowed for this instance'),
    );
    functions.invoke.mockResolvedValue(
      functionRefusal(429, '{"code":"rate_limited","error":"x"}'),
    );
    render(<LoginScreen />);

    askForTheEmail();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
    );
    expect(
      screen.queryByRole('heading', { name: 'Verifică-ți emailul' }),
    ).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows the unknown-error copy when the function fails — never a false "sent"', async () => {
    auth.signInWithOtp.mockResolvedValue(
      authRefusal('signup_disabled', 'Signups not allowed for this instance'),
    );
    functions.invoke.mockResolvedValue(functionRefusal(500));
    render(<LoginScreen />);

    askForTheEmail();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu am putut finaliza conectarea. Încearcă din nou; dacă problema persistă, anunță BC.',
    );
    expect(
      screen.queryByRole('heading', { name: 'Verifică-ți emailul' }),
    ).toBeNull();
  });

  it('leaves a confirmed Member on the ordinary magic link: no function call', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen />);

    askForTheEmail();

    await screen.findByRole('heading', { name: 'Verifică-ți emailul' });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'membru@exemplu.ro',
      options: expect.objectContaining({ shouldCreateUser: false }),
    });
    expect(functions.invoke).not.toHaveBeenCalled();
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

    // `/cereri` is restored, then forwarded to Taskuri's Cereri view (#973).
    await screen.findByRole(
      'heading',
      { name: 'Taskuri' },
      { timeout: 10_000 },
    );
    expect(window.location.pathname + window.location.search).toBe(
      '/tracker?vedere=cereri',
    );
  }, 15_000);
});
