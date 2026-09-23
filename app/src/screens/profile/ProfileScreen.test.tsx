import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { Database } from '../../lib/database.types';
import type { MemberGroup } from '../../queries/reference';
import ProfileScreen from './ProfileScreen';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const authMock = vi.hoisted(() => ({
  claims: null as MemberClaims | null,
  session: { user: { id: 'p1' } },
}));

// The edit sheet asks whether the viewer may change a full name (#675, R5):
// only BC/Moderator (`manageRoles`). Tests that rename set it.
const capabilityMock = vi.hoisted(() => ({ manageRoles: false }));

vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: 'manageRoles') => ({ data: capabilityMock[name] }),
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
    avatar_color: '#ED2025' as string | null,
    joined_year: 2024,
    joined_at: '2024-10-01',
    email: 'maria@osubb.ro',
    phone: '0722334455' as string | null,
  };

  return {
    mockProfile,
    profileQueryMock: {
      data: mockProfile as typeof mockProfile | null | undefined,
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
  };
});

const { mockProfile, profileQueryMock } = profileMocks;

let activeProfileData = { ...mockProfile };
const profileListeners = new Set<(profile: typeof mockProfile) => void>();

function setTestProfile(updated: typeof mockProfile) {
  activeProfileData = updated;
  profileQueryMock.data = updated;
  profileListeners.forEach((fn) => fn(updated));
}

const updateProfileMock = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  error: null,
}));

vi.mock('../../queries/profile', () => ({
  useMyProfile: () => {
    const [profile, setProfile] = useState(
      () => profileMocks.profileQueryMock.data ?? activeProfileData,
    );
    useEffect(() => {
      profileListeners.add(setProfile);
      return () => {
        profileListeners.delete(setProfile);
      };
    }, []);

    const data =
      profileMocks.profileQueryMock.isPending ||
      profileMocks.profileQueryMock.isError
        ? undefined
        : profile;

    return {
      ...profileMocks.profileQueryMock,
      data,
    };
  },
  useUpdateMyProfile: () => ({
    ...updateProfileMock,
    mutateAsync: vi.fn(
      async (input: {
        fullName?: string;
        phone?: string | null;
        avatarColor?: string | null;
      }) => {
        await updateProfileMock.mutateAsync(input);
        const nextProfile = {
          ...activeProfileData,
          ...(input.fullName ? { full_name: input.fullName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.avatarColor !== undefined
            ? { avatar_color: input.avatarColor }
            : {}),
        };
        setTestProfile(nextProfile);
      },
    ),
  }),
}));

const pointsQueryMock = vi.hoisted(() => ({
  data: 42,
  isPending: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('../../queries/points', () => ({
  useMyPoints: () => pointsQueryMock,
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

  const defaultMemberGroups: MemberGroup[] = [
    {
      id: 10,
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      group_role: 'manager',
      position_title: null,
      role_label: 'Director Departament',
    },
    {
      id: 20,
      name: 'Echipa IT',
      short: 'IT',
      color: '#007F33',
      category: 'team',
      group_role: 'responsible',
      position_title: 'Coordonator Tehnic',
      role_label: 'Coordonator Tehnic',
    },
    {
      id: 30,
      name: 'Gala OSUBB',
      short: 'GALA',
      color: '#F5A623',
      category: 'project',
      group_role: 'member',
      position_title: null,
      role_label: 'Membru',
    },
  ];

  return {
    rolesMap,
    defaultMemberGroups,
    rolesQueryMock: {
      data: rolesMap,
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
    groupsQueryMock: {
      data: defaultMemberGroups,
      membershipRows: [],
      isPending: false,
      isError: false,
      error: null as Error | null,
      refetch: vi.fn(),
    },
  };
});

const { rolesMap, defaultMemberGroups, rolesQueryMock, groupsQueryMock } =
  referenceMocks;

vi.mock('../../queries/reference', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../queries/reference')>();
  return {
    ...actual,
    useRoles: () => referenceMocks.rolesQueryMock,
    useMyGroups: () => referenceMocks.groupsQueryMock,
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
    capabilityMock.manageRoles = false;
    document.documentElement.removeAttribute('data-theme');

    authMock.claims = {
      member_role: 'voluntar',
      member_level: 1,
      group_ids: [10, 20, 30],
    };

    profileListeners.clear();
    setTestProfile({ ...mockProfile });
    profileQueryMock.isPending = false;
    profileQueryMock.isError = false;
    profileQueryMock.error = null;

    pointsQueryMock.data = 42;
    pointsQueryMock.isPending = false;
    pointsQueryMock.isError = false;
    pointsQueryMock.error = null;

    rolesQueryMock.data = rolesMap;
    rolesQueryMock.isPending = false;
    rolesQueryMock.isError = false;
    rolesQueryMock.error = null;
    rolesQueryMock.refetch.mockClear();

    groupsQueryMock.data = [...defaultMemberGroups];
    groupsQueryMock.isPending = false;
    groupsQueryMock.isError = false;
    groupsQueryMock.error = null;
    groupsQueryMock.refetch.mockClear();
  });

  it('A Voluntar sees header, contact, edit, Groups, points total, and the theme toggle', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Header
    expect(
      screen.getByRole('heading', { name: /maria enache/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Rol organizațional')).toBeInTheDocument();
    expect(screen.getByText('Voluntar')).toBeInTheDocument();
    expect(screen.getByText(/membru din/i)).toBeInTheDocument();

    // Membership Status is NOT shown (ruling R2)
    expect(screen.queryByText('Activ')).not.toBeInTheDocument();

    // Contact
    expect(screen.getByText('maria@osubb.ro')).toBeInTheDocument();
    expect(
      screen.getByText(
        /autentificarea se face prin link sau cod trimis la această adresă/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('0722334455')).toBeInTheDocument();
    expect(
      screen.getByText(
        /numărul de telefon este vizibil doar pentru tine și membrii cu nivel ≥5/i,
      ),
    ).toBeInTheDocument();

    // Edit button
    expect(
      screen.getByRole('button', { name: /editează profil/i }),
    ).toBeInTheDocument();

    // Groups
    expect(screen.getByTestId('groups-card')).toBeInTheDocument();
    // Voluntar does not see Adunarea Generală chip
    expect(screen.queryByText('Adunarea Generală')).not.toBeInTheDocument();

    // Points total (Punctaj personal)
    expect(screen.getByTestId('personal-points-card')).toBeInTheDocument();
    expect(screen.getByText('Punctaj personal')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    // Theme toggle
    expect(
      screen.getByRole('button', { name: /temă întunecată/i }),
    ).toBeInTheDocument();
  });

  it('A Member in a Department, a Team of it, and a Project sees three groups under three headings with the right Group Role labels', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Headings
    expect(screen.getByText('Departamente')).toBeInTheDocument();
    expect(screen.getByText('Echipe')).toBeInTheDocument();
    expect(screen.getByText('Proiecte')).toBeInTheDocument();

    // Groups & Role labels
    expect(screen.getByText('Educațional')).toBeInTheDocument();
    expect(screen.getByText('Director Departament')).toBeInTheDocument();

    expect(screen.getByText('Echipa IT')).toBeInTheDocument();
    expect(screen.getByText('Coordonator Tehnic')).toBeInTheDocument();

    expect(screen.getByText('Gala OSUBB')).toBeInTheDocument();
    expect(screen.getByText('Membru')).toBeInTheDocument();
  });

  it('A Member with role = "vot" sees the Adunarea Generală chip; a Voluntar does not', () => {
    // Voluntar (level 1)
    const { unmount } = render(<ProfileScreen />, { wrapper: wrapper() });
    expect(screen.queryByText('Adunarea Generală')).not.toBeInTheDocument();
    unmount();

    // Member with role = 'vot' (level 3)
    authMock.claims = {
      member_role: 'vot',
      member_level: 3,
      group_ids: [10],
    };
    setTestProfile({
      ...mockProfile,
      role: 'vot',
    });

    render(<ProfileScreen />, { wrapper: wrapper() });
    expect(screen.getByText('Adunarea Generală')).toBeInTheDocument();
    // No Demisie AG button/dialog in boundary
    expect(
      screen.queryByRole('button', { name: /demisie/i }),
    ).not.toBeInTheDocument();
  });

  it('A BCE sees the same without the points block, and the Adunarea Generală chip', () => {
    authMock.claims = {
      member_role: 'bce',
      member_level: 5,
      group_ids: [10],
    };
    setTestProfile({
      ...mockProfile,
      role: 'bce',
    });

    render(<ProfileScreen />, { wrapper: wrapper() });

    // Points block is absent from the DOM at level >= 5 (ruling R13)
    expect(
      screen.queryByTestId('personal-points-card'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/punctaj personal/i)).not.toBeInTheDocument();

    // Adunarea Generală chip is present
    expect(screen.getByText('Adunarea Generală')).toBeInTheDocument();
  });

  it("Nothing on the page shows another Member's data or a rank", () => {
    // Both for regular volunteer and leadership
    authMock.claims = {
      member_role: 'bce',
      member_level: 5,
      group_ids: [10],
    };
    setTestProfile({
      ...mockProfile,
      role: 'bce',
    });

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.queryByText(/locul/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/clasament/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cupa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/din \d+ membri/i)).not.toBeInTheDocument();
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

  it('opens EditProfileSheet when clicking "Editează profil" and saves updated fields', async () => {
    capabilityMock.manageRoles = true;
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    const editButton = screen.getByRole('button', { name: /editează profil/i });
    await user.click(editButton);

    expect(
      screen.getByRole('heading', { name: /editează profilul/i }),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/nume complet/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Maria Ionescu');

    const saveButton = screen.getByRole('button', { name: /salvează/i });
    await user.click(saveButton);

    expect(updateProfileMock.mutateAsync).toHaveBeenCalledWith({
      fullName: 'Maria Ionescu',
      phone: '0722334455',
      avatarColor: '#ED2025',
    });
  });

  it('after saving a profile edit, the header re-renders with the updated name', async () => {
    capabilityMock.manageRoles = true;
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Initial name in header
    expect(
      screen.getByRole('heading', { name: /maria enache/i }),
    ).toBeInTheDocument();

    // Open edit sheet
    const editButton = screen.getByRole('button', { name: /editează profil/i });
    await user.click(editButton);

    expect(
      screen.getByRole('heading', { name: /editează profilul/i }),
    ).toBeInTheDocument();

    // Type updated name
    const nameInput = screen.getByLabelText(/nume complet/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Maria Ionescu');

    // Save changes
    const saveButton = screen.getByRole('button', { name: /salvează/i });
    await user.click(saveButton);

    // Header re-renders with updated name, old name is gone
    expect(
      await screen.findByRole('heading', { name: /maria ionescu/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /maria enache/i }),
    ).not.toBeInTheDocument();
  });

  it('renders loading state when profile is pending', () => {
    profileQueryMock.isPending = true;

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText(/se încarcă profilul/i)).toBeInTheDocument();
  });

  it('renders error state and retries on profile failure', async () => {
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

  it('renders empty state when member has no assigned groups', () => {
    groupsQueryMock.data = [];

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByText(/nu faci parte din nicio echipă încă/i),
    ).toBeInTheDocument();
  });

  it('renders Necompletat placeholder when phone number is missing', () => {
    setTestProfile({
      ...mockProfile,
      phone: null,
    });

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(screen.getByText('Necompletat')).toBeInTheDocument();
  });
});
