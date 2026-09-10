import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('./lib/auth', () => ({ useAuth: auth.useAuth }));
vi.mock('@ionic/react', () => ({
  IonApp: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonSpinner: ({ 'aria-label': label }: { 'aria-label': string }) => (
    <div role="status" aria-label={label} />
  ),
}));
vi.mock('./components/shell/AppShell', async () => {
  const { Outlet } =
    await vi.importActual<typeof import('react-router')>('react-router');
  return { default: () => <Outlet /> };
});
vi.mock('./screens/login/LoginScreen', () => ({
  default: () => <h1>Login screen</h1>,
}));
vi.mock('./screens/login/AuthCallback', () => ({ default: () => null }));
vi.mock('./screens/no-profile/NoProfileScreen', () => ({
  default: () => <h1>No profile screen</h1>,
}));
vi.mock('./screens/Placeholder', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('./screens/dashboard/DashboardScreen', () => ({ default: () => null }));
vi.mock('./screens/tracker/TrackerScreen', () => ({ default: () => null }));
vi.mock('./screens/calendar/CalendarScreen', () => ({ default: () => null }));

import App from './App';

const signedOut = {
  session: null,
  claims: null,
  loading: false,
  signOut: vi.fn(),
};
const member = {
  session: { user: { id: 'member' } },
  claims: {
    member_role: 'bc',
    member_level: 6,
    dept_ids: [],
    team_ids: [],
  },
  loading: false,
  signOut: vi.fn(),
};

describe('route guards', () => {
  beforeEach(() => {
    auth.useAuth.mockReset();
    window.history.pushState({}, '', '/');
  });

  it('redirects a signed-out visitor from /no-profile to login', async () => {
    auth.useAuth.mockReturnValue(signedOut);
    window.history.pushState({}, '', '/no-profile');

    render(<App />);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Login screen' }),
      ).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/login');
  });

  it('keeps a capability route pending while its member session loads', () => {
    auth.useAuth
      .mockReturnValueOnce(member)
      .mockReturnValueOnce({ ...signedOut, loading: true });
    window.history.pushState({}, '', '/voluntari');

    render(<App />);

    expect(
      screen.getByRole('status', { name: 'Se încarcă' }),
    ).toBeInTheDocument();
  });

  it('redirects from a capability route if its composed member guard has no session', async () => {
    auth.useAuth.mockReturnValueOnce(member).mockReturnValue(signedOut);
    window.history.pushState({}, '', '/voluntari');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });
});
