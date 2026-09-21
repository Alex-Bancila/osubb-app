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
    phone: '0722334455' as string | null,
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
  data: {
    rank: 3,
    total: 12,
    next: { rank: 2, gap: 5 } as { rank: number; gap: number } | null,
  },
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const referenceMocks = vi.hoisted(() => {
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
      1,
      {
        id: 1,
        name: 'Organizația Studenților din UBB',
        short: 'OSUBB',
        color: '#ED2025',
        category: 'organization',
        path: [1],
        parent_id: null,
        min_level: 0,
        status: 'active',
        is_organization: true,
        automatic_membership: true,
        legacy_dept_id: null,
      },
    ],
    [
      2,
      {
        id: 2,
        name: 'Adunarea Generală',
        short: 'AG',
        color: '#1B365D',
        category: 'organization',
        path: [2],
        parent_id: null,
        min_level: 3,
        status: 'active',
        is_organization: false,
        automatic_membership: true,
        legacy_dept_id: null,
      },
    ],
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

  return {
    rolesMap,
    groupsMap,
    rolesQueryMock: {
      data: rolesMap,
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
    groupsQueryMock: {
      data: groupsMap,
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
  };
});

const { rolesMap, groupsMap, rolesQueryMock, groupsQueryMock } = referenceMocks;

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

vi.mock('../../queries/reference', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../queries/reference')>();
  return {
    ...actual,
    useRoles: () => referenceMocks.rolesQueryMock,
    useGroups: () => referenceMocks.groupsQueryMock,
  };
});

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
    profileQueryMock.error = null;

    pointsQueryMock.data = 42;
    pointsQueryMock.isPending = false;
    pointsQueryMock.isError = false;
    pointsQueryMock.error = null;

    standingQueryMock.data = { rank: 3, total: 12, next: { rank: 2, gap: 5 } };
    standingQueryMock.isPending = false;
    standingQueryMock.isError = false;
    standingQueryMock.error = null;

    rolesQueryMock.data = rolesMap;
    rolesQueryMock.isPending = false;
    rolesQueryMock.isError = false;
    rolesQueryMock.error = null;
    rolesQueryMock.refetch.mockClear();

    groupsQueryMock.data = groupsMap;
    groupsQueryMock.isPending = false;
    groupsQueryMock.isError = false;
    groupsQueryMock.error = null;
    groupsQueryMock.refetch.mockClear();
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

    // Groups rendered (automatic Organization group + explicit roster groups)
    expect(
      screen.getByText('Organizația Studenților din UBB'),
    ).toBeInTheDocument();
    expect(screen.getByText('OSUBB')).toBeInTheDocument();
    expect(screen.getByText('Educațional')).toBeInTheDocument();
    expect(screen.getByText('Echipa IT')).toBeInTheDocument();
    expect(screen.queryByText('Adunarea Generală')).not.toBeInTheDocument();
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

  it('renders empty state when member has no assigned groups', () => {
    groupsQueryMock.data = new Map();
    authMock.claims = {
      member_role: 'voluntar',
      member_level: 1,
      dept_ids: [],
      team_ids: [],
      group_ids: [],
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByText(/nu faci parte din nicio echipă încă/i),
    ).toBeInTheDocument();
  });

  it('automatically includes organization group for volunteer without AG', () => {
    authMock.claims = {
      member_role: 'voluntar',
      member_level: 1,
      dept_ids: [],
      team_ids: [],
      group_ids: [], // No explicit roster memberships in JWT claims
    };
    profileQueryMock.data = {
      ...mockProfile,
      role: 'voluntar',
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    // Organization group (min_level 0, automatic) is present
    expect(
      screen.getByText('Organizația Studenților din UBB'),
    ).toBeInTheDocument();
    expect(screen.getByText('OSUBB')).toBeInTheDocument();
    // Adunarea Generală (min_level 3, automatic) is absent for level 1
    expect(screen.queryByText('Adunarea Generală')).not.toBeInTheDocument();
    // No explicit groups rendered
    expect(screen.queryByText('Educațional')).not.toBeInTheDocument();
    expect(screen.queryByText('Echipa IT')).not.toBeInTheDocument();
  });

  it('automatically includes both organization group and Adunarea Generală for eligible voting members', () => {
    authMock.claims = {
      member_role: 'vot',
      member_level: 3,
      dept_ids: [],
      team_ids: [],
      group_ids: [], // No explicit roster memberships in JWT claims
    };
    profileQueryMock.data = {
      ...mockProfile,
      role: 'vot',
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    // Both automatic groups are present for level 3
    expect(
      screen.getByText('Organizația Studenților din UBB'),
    ).toBeInTheDocument();
    expect(screen.getByText('OSUBB')).toBeInTheDocument();
    expect(screen.getByText('Adunarea Generală')).toBeInTheDocument();
    expect(screen.getByText('AG')).toBeInTheDocument();
  });

  it('renders error state and retries on roles query failure', async () => {
    const user = userEvent.setup();
    rolesQueryMock.isError = true;
    rolesQueryMock.error = new Error('Eroare la încărcarea rolurilor');

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByText(/nu am putut încărca profilul/i),
    ).toBeInTheDocument();

    const retryButton = screen.getByText(/încearcă din nou/i);
    await user.click(retryButton);

    expect(rolesQueryMock.refetch).toHaveBeenCalled();
  });

  it('renders error state and retries on groups query failure', async () => {
    const user = userEvent.setup();
    groupsQueryMock.isError = true;
    groupsQueryMock.error = new Error('Eroare la încărcarea grupurilor');

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByText(/nu am putut încărca profilul/i),
    ).toBeInTheDocument();

    const retryButton = screen.getByText(/încearcă din nou/i);
    await user.click(retryButton);

    expect(groupsQueryMock.refetch).toHaveBeenCalled();
  });

  it('renders Necompletat placeholder when phone number is missing', () => {
    profileQueryMock.data = {
      ...mockProfile,
      phone: null,
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText('Necompletat')).toBeInTheDocument();
  });

  it('renders Locul 1 trophy when leader is in first place', () => {
    authMock.claims = {
      member_role: 'bc',
      member_level: 6,
      dept_ids: ['edu'],
      team_ids: [],
      group_ids: [10],
    };
    profileQueryMock.data = {
      ...mockProfile,
      role: 'bc',
    };
    standingQueryMock.data = {
      rank: 1,
      total: 10,
      next: null,
    };

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText(/locul 1 🏆/i)).toBeInTheDocument();
  });
});
