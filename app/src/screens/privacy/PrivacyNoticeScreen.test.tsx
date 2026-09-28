import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({ useAuth: auth }));
vi.mock('./PrivacyNoticeContent', () => ({
  PrivacyNoticeContent: () => <h1>Politica de confidențialitate</h1>,
}));
import PrivacyNoticeScreen from './PrivacyNoticeScreen';

const session = { user: { id: 'member' } };
const claims = { member_role: 'voluntar', member_level: 1, group_ids: [] };

function show(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/confidentialitate', state }]}>
      <PrivacyNoticeScreen />
    </MemoryRouter>,
  );
  return screen.getByRole('link');
}

beforeEach(() => {
  auth.mockReturnValue({ session, claims, loading: false });
});

it('goes back where the notice was opened from (D15)', () => {
  const link = show({
    from: {
      to: '/administrare/confidentialitate',
      label: 'Înapoi la Administrare',
    },
  });
  expect(link).toHaveAccessibleName('Înapoi la Administrare');
  expect(link).toHaveAttribute('href', '/administrare/confidentialitate');
});

it('goes back to Profil for a member without an origin', () => {
  const link = show();
  expect(link).toHaveAccessibleName('Înapoi la Profil');
  expect(link).toHaveAttribute('href', '/profil');
});

it('sends a session without claims to its own screen, never to Profil', () => {
  auth.mockReturnValue({ session, claims: null, loading: false });
  expect(show()).toHaveAttribute('href', '/no-profile');
});

it('goes back to sign-in without a session', () => {
  auth.mockReturnValue({ session: null, claims: null, loading: false });
  const link = show();
  expect(link).toHaveAccessibleName('Înapoi la conectare');
  expect(link).toHaveAttribute('href', '/login');
});
