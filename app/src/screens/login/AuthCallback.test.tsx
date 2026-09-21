import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } },
}));

import AuthCallback from './AuthCallback';

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<h1>Aplicație</h1>} />
        <Route path="/cereri" element={<h1>Cereri</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthCallback', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/auth/callback');
    mocks.useAuth.mockReturnValue({ loading: true, session: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it('shows a reachable progress state while the session is being established', () => {
    renderCallback();

    expect(screen.getByRole('status', { name: 'Te conectăm…' })).toBeVisible();
  });

  it('shows callback URL failures and a way back to login', () => {
    window.history.replaceState(
      {},
      '',
      '/auth/callback?error=access_denied&error_description=Link+expired',
    );
    renderCallback();

    expect(
      screen.getByRole('heading', { name: 'Linkul nu a funcționat' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Înapoi la conectare' }),
    ).toHaveAttribute('href', '/login');
  });

  it('exchanges a PKCE code and reports a safe failure', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { code: 'bad_code_verifier', message: 'private exchange details' },
    });
    window.history.replaceState({}, '', '/auth/callback?code=one-time-code');
    renderCallback();

    await waitFor(() =>
      expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
        'one-time-code',
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'Linkul nu a funcționat' }),
    ).toBeVisible();
    expect(screen.queryByText(/private exchange details/i)).toBeNull();
  });

  it('restores a validated destination after callback establishes the session', () => {
    window.history.replaceState({}, '', '/auth/callback?next=%2Fcereri');
    mocks.useAuth.mockReturnValue({
      loading: false,
      session: { user: { id: 'member' } },
    });
    renderCallback();
    expect(screen.getByRole('heading', { name: 'Cereri' })).toBeVisible();
  });

  it('hands an established session back to the route guards', () => {
    mocks.useAuth.mockReturnValue({
      loading: false,
      session: { user: { id: 'member' } },
    });
    renderCallback();

    expect(screen.getByRole('heading', { name: 'Aplicație' })).toBeVisible();
  });
});
