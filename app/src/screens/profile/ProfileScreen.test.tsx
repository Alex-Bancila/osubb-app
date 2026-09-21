import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { Database } from '../../lib/database.types';
import type { Group } from '../../queries/reference';
import ProfileScreen from './ProfileScreen';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const authMock = vi.hoisted(() => ({
  claims: null as MemberClaims | null,
  session: { user: { id: 'p1' } },
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    claims: authMock.claims,
    session: authMock.session,
    loading: false,
    signOut: vi.fn(),
  }),
}));

const profileMocks = vi.hoisted(() => {
  const mockProfile = {
    id: 'p1',
    full_name: 'Maria Enache',
    role: 'voluntar' as Database['public']['Enums']['member_role'],
    status: 'activ' as const,
    tier: null,
    avatar_color: '#ED2025',
    joined_year: 2024,
    joined_at: '2024-10-01',
    email: 'maria@osubb.ro',
    phone: '0722334455',
  };

  return {
    mockProfile,
    profileQueryMock: {
      data: mockProfile,
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
  };
});

const { mockProfile, profileQueryMock } = profileMocks;

const pointsQueryMock = vi.hoisted(() => ({
  data: 42,
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const standingQueryMock = vi.hoisted(() => ({
  data: { rank: 3, total: 12, next: { rank: 2, gap: 5 } },
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const rolesMap = new Map([
  ['recrut', { name: 'Recrut', level: 0 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['activ', { name: 'Voluntar Activ', level: 2 }],
  ['vot', { name: 'Membru cu Drept de Vot', level: 3 }],
  ['bce', { name: 'BCE', level: 5 }],
  ['bc', { name: 'BC', level: 6 }],
]);

const groupsMap = new Map<number, Group>([
  [
    10,
    {
      id: 10,
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [10],
      parent_id: null,
      min_level: 0,
      status: 'active',
      is_organization: false,
      legacy_dept_id: 'edu',
    },
  ],
  [
    20,
    {
      id: 20,
      name: 'Echipa IT',
      short: 'IT',
      color: '#007F33',
      category: 'team',
      path: [15, 20],
      parent_id: 15,
      min_level: 0,
      status: 'active',
      is_organization: false,
      legacy_dept_id: null,
    },
  ],
]);

vi.mock('../../queries/profile', () => ({
  useMyProfile: () => profileMocks.profileQueryMock,
  useUpdateMyProfile: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../queries/points', () => ({
  useMyPoints: () => pointsQueryMock,
  useMyStanding: () => standingQueryMock,
}));

vi.mock('../../queries/reference', () => ({
  useRoles: () => ({
    data: rolesMap,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGroups: () => ({
    data: groupsMap,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

function wrapper(queryClient = new QueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    authMock.claims = {
      member_role: 'voluntar',
      member_level: 1,
      dept_ids: ['edu'],
      team_ids: [],
      group_ids: [10, 20],
    };

    profileQueryMock.data = { ...mockProfile };
    profileQueryMock.isPending = false;
    profileQueryMock.isError = false;

    pointsQueryMock.data = 42;
    pointsQueryMock.isPending = false;
    pointsQueryMock.isError = false;

    standingQueryMock.data = { rank: 3, total: 12, next: { rank: 2, gap: 5 } };
    standingQueryMock.isPending = false;
    standingQueryMock.isError = false;
  });

  it('renders profile header, contact fields, and groups', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByRole('heading', { name: /maria enache/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Voluntar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Activ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('maria@osubb.ro')).toBeInTheDocument();
    expect(screen.getByText('0722334455')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    // Groups rendered
    expect(screen.getByText('Educațional')).toBeInTheDocument();
    expect(screen.getByText('Echipa IT')).toBeInTheDocument();
  });

  it('toggles theme between light and dark', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    const themeButton = screen.getByRole('button', { name: /temă/i });
    await user.click(themeButton);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('osubb-theme')).toBe('dark');

    await user.click(themeButton);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('osubb-theme')).toBe('light');
  });

  it('shows leadership standing only to members at level >= 5', () => {
    // Ordinary volunteer (level 1)
    render(<ProfileScreen />, { wrapper: wrapper() });
    expect(
      screen.getByText(
        /clasamentul și cupa departamentelor sunt vizibile pentru bce și bc/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/din 12 membri/i)).not.toBeInTheDocument();
  });

  it('shows rank and next-target note to leadership members', () => {
    authMock.claims = {
      member_role: 'bce',
      member_level: 5,
      dept_ids: ['edu'],
      team_ids: [],
      group_ids: [10],
    };
    profileQueryMock.data = {
      ...mockProfile,
      role: 'bce',
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText(/din 12 membri/i)).toBeInTheDocument();
    expect(screen.getByText(/5 p până la locul 2/i)).toBeInTheDocument();
  });

  it('opens EditProfileSheet when clicking "Editează profil"', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    const editButton = screen.getByRole('button', { name: /editează profil/i });
    await user.click(editButton);

    expect(
      screen.getByRole('heading', { name: /editează profilul/i }),
    ).toBeInTheDocument();
  });

  it('renders Demisie AG button and confirmation dialog for Drept de Vot members', async () => {
    const user = userEvent.setup();
    authMock.claims = {
      member_role: 'vot',
      member_level: 3,
      dept_ids: ['edu'],
      team_ids: [],
      group_ids: [10],
    };
    profileQueryMock.data = {
      ...mockProfile,
      role: 'vot',
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    const resignButton = screen.getByRole('button', {
      name: /demisie din ag/i,
    });
    expect(resignButton).toBeInTheDocument();

    await user.click(resignButton);

    expect(
      screen.getByText(
        /această solicitare necesită aprobarea biroului de conducere/i,
      ),
    ).toBeInTheDocument();
  });

  it('renders loading state when profile is pending', () => {
    profileQueryMock.isPending = true;

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText(/se încarcă profilul/i)).toBeInTheDocument();
  });

  it('renders error state and retries on failure', async () => {
    const user = userEvent.setup();
    profileQueryMock.isError = true;
    profileQueryMock.error = new Error('Database disconnected');

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByText(/nu am putut încărca profilul/i),
    ).toBeInTheDocument();

    const retryButton = screen.getByText(/încearcă din nou/i);
    await user.click(retryButton);

    expect(profileQueryMock.refetch).toHaveBeenCalled();
  });
});
