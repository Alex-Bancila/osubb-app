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
vi.mock('./screens/login/AuthCallback', () => ({
  default: () => <h1>Auth callback</h1>,
}));
vi.mock('./screens/no-profile/NoProfileScreen', () => ({
  default: () => <h1>No profile screen</h1>,
}));
vi.mock('./screens/volunteers/VolunteersScreen', () => ({
  default: () => <h1>Voluntari</h1>,
}));
vi.mock('./screens/Placeholder', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('./screens/dashboard/DashboardScreen', () => ({
  default: () => <h1>Dashboard</h1>,
}));
vi.mock('./screens/tracker/TrackerScreen', () => ({ default: () => null }));
vi.mock('./screens/calendar/CalendarScreen', () => ({ default: () => null }));
vi.mock('./screens/requests/CompletedWorkRequestScreen', () => ({
  default: () => <h1>Cereri screen</h1>,
}));
vi.mock('./screens/announcements/AnnouncementsScreen', () => ({
  default: () => <h1>Anunțuri screen</h1>,
}));
vi.mock('./screens/notifications/NotificationsScreen', () => ({
  default: () => <h1>Notificări screen</h1>,
}));
vi.mock('./screens/profile/ProfileScreen', () => ({
  default: () => <h1>Profil screen</h1>,
}));

vi.mock('./screens/leadership/LeadershipScreen', () => ({
  default: () => <h1>Clasament screen</h1>,
}));
vi.mock('./screens/leadership/MemberTrackerScreen', () => ({
  default: () => <h1>Member history screen</h1>,
}));
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
    group_ids: [],
  },
  loading: false,
  signOut: vi.fn(),
};
const noProfile = { ...member, claims: null };
const ordinaryMember = {
  ...member,
  claims: { ...member.claims, member_level: 1 },
};

describe('route guards', () => {
  beforeEach(() => {
    auth.useAuth.mockReset();
    window.history.pushState({}, '', '/');
  });

  it('preserves a deep link and restores it after the session arrives', async () => {
    auth.useAuth.mockReturnValue(signedOut);
    window.history.pushState({}, '', '/cereri?source=test#requests');
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'Login screen' });
    expect(new URLSearchParams(window.location.search).get('next')).toBe(
      '/cereri?source=test#requests',
    );
    auth.useAuth.mockReturnValue(member);
    view.rerender(<App />);
    await screen.findByRole('heading', { name: 'Cereri screen' });
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe('/cereri?source=test#requests');
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

  it('waits for session loading before showing /no-profile', () => {
    auth.useAuth.mockReturnValue({ ...signedOut, loading: true });
    window.history.pushState({}, '', '/no-profile');

    render(<App />);

    expect(
      screen.getByRole('status', { name: 'Se încarcă' }),
    ).toBeInTheDocument();
  });

  it('shows /no-profile to a signed-in account without claims', () => {
    auth.useAuth.mockReturnValue(noProfile);
    window.history.pushState({}, '', '/no-profile');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'No profile screen' }),
    ).toBeInTheDocument();
  });

  it('waits for member loading before rendering the app shell', () => {
    auth.useAuth.mockReturnValue({ ...signedOut, loading: true });

    render(<App />);

    expect(
      screen.getByRole('status', { name: 'Se încarcă' }),
    ).toBeInTheDocument();
  });

  it('redirects a signed-in account without claims to /no-profile', async () => {
    auth.useAuth.mockReturnValue(noProfile);

    render(<App />);

    await screen.findByRole('heading', { name: 'No profile screen' });
    expect(window.location.pathname).toBe('/no-profile');
  });

  it('renders the member dashboard for an active member', () => {
    auth.useAuth.mockReturnValue(member);

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();
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

  it('redirects a member who lacks a route capability to the dashboard', async () => {
    auth.useAuth.mockReturnValue(ordinaryMember);
    window.history.pushState({}, '', '/voluntari');

    render(<App />);

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(window.location.pathname).toBe('/');
  });

  it('renders a capability route for a member at the required level', () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/voluntari');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Voluntari' }),
    ).toBeInTheDocument();
  });

  it('keeps a loading session on the login front door undecided', () => {
    auth.useAuth.mockReturnValue({ ...signedOut, loading: true });
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(
      screen.getByRole('status', { name: 'Se încarcă' }),
    ).toBeInTheDocument();
  });

  it('redirects an active member away from the login front door', async () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/login');

    render(<App />);

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(window.location.pathname).toBe('/');
  });

  it('redirects a signed-in account without claims away from login', async () => {
    auth.useAuth.mockReturnValue(noProfile);
    window.history.pushState({}, '', '/login');

    render(<App />);

    await screen.findByRole('heading', { name: 'No profile screen' });
    expect(window.location.pathname).toBe('/no-profile');
  });

  it('keeps the callback route available without a session', () => {
    auth.useAuth.mockReturnValue(signedOut);
    window.history.pushState({}, '', '/auth/callback');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Auth callback' }),
    ).toBeInTheDocument();
  });

  it('sends an unknown path through the member guard to the dashboard', async () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/necunoscut');

    render(<App />);

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(window.location.pathname).toBe('/');
  });

  it('renders the notification centre for an active member at /notificari', () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/notificari');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Notificări screen' }),
    ).toBeInTheDocument();
  });

  it('renders the announcements screen for an active member at /anunturi', () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/anunturi');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Anunțuri screen' }),
    ).toBeInTheDocument();
  });

  it('renders the profile screen for an active member at /profil', () => {
    auth.useAuth.mockReturnValue(member);
    window.history.pushState({}, '', '/profil');

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Profil screen' }),
    ).toBeInTheDocument();
  });
});

it.each(['/clasament', '/tracker/membru/35400000-0000-0000-0000-000000000001'])(
  'protects leadership route %s with an explanation',
  async (path) => {
    auth.useAuth.mockReturnValue(ordinaryMember);
    window.history.pushState({}, '', path);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(window.history.state.usr).toEqual({ leadershipDenied: true });
  },
);
it('opens the leadership page for BCE', () => {
  auth.useAuth.mockReturnValue({
    ...member,
    claims: { ...member.claims, member_level: 5 },
  });
  window.history.pushState({}, '', '/clasament');
  render(<App />);
  expect(
    screen.getByRole('heading', { name: 'Clasament screen' }),
  ).toBeInTheDocument();
});
