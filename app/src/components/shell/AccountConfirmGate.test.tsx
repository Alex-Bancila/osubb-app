import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: mocks.signOut } },
}));

import {
  ANY_ACCOUNT,
  markAccountPending,
  pendingAccount,
} from '../../lib/sign-in-request';
import { AccountConfirmGate } from './AccountConfirmGate';

const SESSION = {
  user: { id: 'user-1', email: 'membru@exemplu.ro' },
} as unknown as Session;

function renderGate() {
  return render(
    <AccountConfirmGate session={SESSION}>
      <h1>Aplicație</h1>
    </AccountConfirmGate>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.signOut.mockResolvedValue({ error: null });
});

it('lets a session in when no account is waiting for confirmation', () => {
  renderGate();
  expect(screen.getByRole('heading', { name: 'Aplicație' })).toBeVisible();

  // A stale flag for another account holds nothing.
  act(() => markAccountPending('user-2'));
  expect(screen.getByRole('heading', { name: 'Aplicație' })).toBeVisible();
});

it('holds the app, with the verified address, until the Member confirms (security audit F3)', () => {
  markAccountPending('user-1');
  renderGate();

  expect(
    screen.getByRole('heading', { name: 'Confirmă contul' }),
  ).toBeVisible();
  expect(screen.getByText('membru@exemplu.ro')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Aplicație' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(screen.getByRole('heading', { name: 'Aplicație' })).toBeVisible();
  expect(pendingAccount()).toBeNull();
});

it('holds any session while a link is still being verified', () => {
  markAccountPending(ANY_ACCOUNT);
  renderGate();
  expect(
    screen.getByRole('heading', { name: 'Confirmă contul' }),
  ).toBeVisible();
});

it('follows a confirmation started in another tab', () => {
  renderGate();
  expect(screen.getByRole('heading', { name: 'Aplicație' })).toBeVisible();

  act(() => {
    localStorage.setItem('osubb.account-pending', 'user-1');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'osubb.account-pending' }),
    );
  });
  expect(
    screen.getByRole('heading', { name: 'Confirmă contul' }),
  ).toBeVisible();
});

it('signs out on this device on "Nu este adresa mea", and stays held if that fails', async () => {
  markAccountPending('user-1');
  mocks.signOut.mockResolvedValueOnce({
    error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
  });
  renderGate();

  fireEvent.click(screen.getByRole('button', { name: 'Nu este adresa mea' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(pendingAccount()).toBe('user-1');

  fireEvent.click(screen.getByRole('button', { name: 'Nu este adresa mea' }));
  await vi.waitFor(() => expect(pendingAccount()).toBeNull());
});
