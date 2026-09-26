import * as axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { verifyOtp: mocks.verifyOtp } },
}));

import { loginEmailFrom } from '../../lib/auth-destination';
import AuthConfirm from './AuthConfirm';

function LoginProbe() {
  const location = useLocation();
  return (
    <>
      <h1>Conectare</h1>
      <p>next={new URLSearchParams(location.search).get('next') ?? ''}</p>
      <p>email={loginEmailFrom(location.state)}</p>
    </>
  );
}

function renderConfirm(search: string) {
  window.history.replaceState({}, '', `/auth/confirm${search}`);
  return render(
    <MemoryRouter initialEntries={[`/auth/confirm${search}`]}>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirm />} />
        <Route path="/" element={<h1>Aplicație</h1>} />
        <Route path="/cereri" element={<h1>Cereri</h1>} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const inviteLink =
  '?token_hash=hash-123&type=invite&email=membru%2Bosubb%40exemplu.ro';

describe('AuthConfirm', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ loading: false, session: null });
    mocks.verifyOtp.mockReset();
    mocks.verifyOtp.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    });
  });

  it('renders one button and spends nothing until the Member taps', async () => {
    const { container } = renderConfirm(inviteLink);

    expect(
      screen.getByRole('heading', { name: 'Conectare la aplicația OSUBB' }),
    ).toBeVisible();
    expect(screen.getByText('membru+osubb@exemplu.ro')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Conectează-mă' })).toBeEnabled();

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);

    // A mail scanner fetching the page is exactly this render: no verify call.
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('does not sign in on load even when a session already exists', () => {
    mocks.useAuth.mockReturnValue({
      loading: false,
      session: { access_token: 'existing' },
    });
    renderConfirm('?token_hash=hash-123&type=email_change');

    expect(screen.getByRole('button', { name: 'Conectează-mă' })).toBeVisible();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(['invite', 'email', 'magiclink', 'email_change'])(
    'verifies a %s link with its token hash on tap, then follows the destination',
    async (type) => {
      const redirect = encodeURIComponent(
        'http://localhost:5173/auth/callback?next=%2Fcereri',
      );
      let settle: () => void = () => undefined;
      mocks.verifyOtp.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = () => {
              // The auth listener would publish the stored session.
              mocks.useAuth.mockReturnValue({
                loading: false,
                session: { access_token: 'token' },
              });
              resolve({
                data: { session: { access_token: 'token' } },
                error: null,
              });
            };
          }),
      );
      renderConfirm(
        `?token_hash=hash-123&type=${type}&redirect_to=${redirect}`,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'hash-123',
        type,
      });
      expect(
        screen.getByRole('button', { name: 'Te conectăm…' }),
      ).toBeDisabled();

      settle();
      await screen.findByRole('heading', { name: 'Cereri' });
    },
  );

  it('never follows a redirect_to outside the member routes', async () => {
    const redirect = encodeURIComponent(
      'https://evil.example/auth/callback?next=%2F%2Fevil.example',
    );
    mocks.verifyOtp.mockImplementation(async () => {
      mocks.useAuth.mockReturnValue({
        loading: false,
        session: { access_token: 'token' },
      });
      return { data: { session: { access_token: 'token' } }, error: null };
    });
    renderConfirm(`?token_hash=hash-123&type=email&redirect_to=${redirect}`);

    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    await screen.findByRole('heading', { name: 'Aplicație' });
  });

  it('shows the Romanian message and a retry link with the email handed over', async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: {
        code: 'otp_expired',
        message: 'Token has expired or is invalid',
      },
    });
    const redirect = encodeURIComponent(
      'http://localhost:5173/auth/callback?next=%2Fcereri',
    );
    renderConfirm(`${inviteLink}&redirect_to=${redirect}`);

    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Linkul a expirat sau a fost deja folosit. Cere unul nou.',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Trimite alt link' }));

    await screen.findByRole('heading', { name: 'Conectare' });
    expect(screen.getByText('next=/cereri')).toBeInTheDocument();
    expect(
      screen.getByText('email=membru+osubb@exemplu.ro'),
    ).toBeInTheDocument();
  });

  it('reports a thrown failure safely and lets the Member try again', async () => {
    mocks.verifyOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderConfirm(inviteLink);

    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu te-am putut conecta la internet.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledTimes(2));
  });

  it('refuses a link without a token hash or with an unknown type', () => {
    renderConfirm('?type=signup&token_hash=hash-123');

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Linkul de conectare nu este valid. Cere unul nou.',
    );
    expect(
      screen.getByRole('link', { name: 'Trimite alt link' }),
    ).toHaveAttribute('href', '/login');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('asks for the second address when an email change is half confirmed', async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });
    renderConfirm('?token_hash=hash-123&type=email_change');

    fireEvent.click(screen.getByRole('button', { name: 'Conectează-mă' }));

    await screen.findByRole('heading', { name: 'Adresă confirmată' });
    expect(
      screen.getByRole('link', { name: 'Mergi în aplicație' }),
    ).toHaveAttribute('href', '/');
  });
});
