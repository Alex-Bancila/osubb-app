import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { Database } from '../../lib/database.types';
import type { GroupApplication } from '../../queries/group-applications';
import type { Group, MemberGroup } from '../../queries/reference';
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
    nickname: null as string | null,
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
        nickname?: string | null;
        phone?: string | null;
        avatarColor?: string | null;
      }) => {
        await updateProfileMock.mutateAsync(input);
        const nextProfile = {
          ...activeProfileData,
          ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
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
    // Every readable Group, which names a pending Application's Group.
    allGroupsQueryMock: {
      data: new Map<number, Pick<Group, 'id' | 'name' | 'color'>>([
        [40, { id: 40, name: 'Echipa Media', color: '#7500A0' }],
      ]),
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
    useGroups: () => referenceMocks.allGroupsQueryMock,
  };
});

// #589's read and withdraw, as the joining card (R18) uses them.
const applicationMocks = vi.hoisted(() => ({
  useGroupApplications: vi.fn(),
  applicationsQuery: {
    data: [] as GroupApplication[],
    isPending: false,
    isError: false,
  },
  withdraw: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../queries/group-applications', () => ({
  useGroupApplications: applicationMocks.useGroupApplications,
  useApplicationCommand: () => ({
    mutateAsync: applicationMocks.withdraw,
    isPending: false,
  }),
}));

const pendingApplication: GroupApplication = {
  id: 501,
  group_id: 40,
  member_id: 'p1',
  status: 'pending',
  note: null,
  created_at: '2026-09-20T10:00:00Z',
  decided_at: null,
  decided_by: null,
  decision_note: null,
  member: { memberId: 'p1', fullName: 'Maria Enache' },
};

function wrapper(queryClient = new QueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MemoryRouter>
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

    applicationMocks.applicationsQuery.data = [pendingApplication];
    applicationMocks.applicationsQuery.isPending = false;
    applicationMocks.applicationsQuery.isError = false;
    applicationMocks.useGroupApplications.mockImplementation(
      () => applicationMocks.applicationsQuery,
    );
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

  it('opens EditProfileSheet when clicking "Editează profil" and saves the Nickname, never the full name', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    await user.click(screen.getByRole('button', { name: /editează profil/i }));

    expect(
      screen.getByRole('heading', { name: /editează profilul/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nume complet')).toHaveAttribute('readonly');

    await user.type(screen.getByLabelText('Pseudonim'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(updateProfileMock.mutateAsync).toHaveBeenCalledWith({
      nickname: 'Mara',
      phone: '+40722334455',
      avatarColor: '#ED2025',
    });
  });

  it('after saving a Nickname, the heading shows it with the full name underneath', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Without a Nickname the full name is the heading, and is not repeated.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Maria Enache' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profile-full-name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /editează profil/i }));
    await user.type(screen.getByLabelText('Pseudonim'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Mara' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('profile-full-name')).toHaveTextContent(
      'Maria Enache',
    );
  });

  it('shows the Nickname as the heading with the full name underneath', () => {
    setTestProfile({ ...mockProfile, nickname: 'Mara' });
    render(<ProfileScreen />, { wrapper: wrapper() });

    const heading = screen.getByRole('heading', { level: 2, name: 'Mara' });
    const fullName = screen.getByTestId('profile-full-name');
    expect(fullName).toHaveTextContent('Maria Enache');
    // The full name follows the Nickname in the identity block.
    expect(
      heading.compareDocumentPosition(fullName) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Maria Enache' }),
    ).not.toBeInTheDocument();
  });

  it('does not repeat the full name when the Nickname is the same', () => {
    setTestProfile({ ...mockProfile, nickname: 'Maria Enache' });
    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.getByRole('heading', { level: 2, name: 'Maria Enache' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profile-full-name')).not.toBeInTheDocument();
  });

  describe('Grupurile mele (R18)', () => {
    it('at level 1 shows the memberships, a pending Application with withdraw, and the button to /grupuri', async () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      const card = screen.getByTestId('groups-card');
      expect(
        within(card).getByRole('heading', { name: 'Grupurile mele' }),
      ).toBeInTheDocument();
      // One card: the memberships stay in it, listed once.
      expect(within(card).getByText('Educațional')).toBeInTheDocument();
      expect(within(card).getByText('Echipa IT')).toBeInTheDocument();
      expect(within(card).getByText('Gala OSUBB')).toBeInTheDocument();
      expect(screen.getAllByText('Educațional')).toHaveLength(1);

      const joining = within(card).getByTestId('joining-section');
      expect(
        within(joining).getByRole('heading', { name: 'Cereri în așteptare' }),
      ).toBeInTheDocument();
      const pending = within(joining).getByRole('listitem');
      expect(pending).toHaveTextContent('Echipa Media');
      expect(
        within(pending).getByRole('button', { name: 'Retrage aplicația' }),
      ).toBeInTheDocument();

      const apply = within(card).getByRole('link', {
        name: 'Aplică la un grup',
      });
      expect(apply).toHaveAttribute('href', '/grupuri');
      expect(applicationMocks.useGroupApplications).toHaveBeenCalled();

      expect((await axe.run(card)).violations).toEqual([]);
    });

    it('withdraws a pending Application through the #589 command and keeps the confirmation once the row is gone', async () => {
      const user = userEvent.setup();
      // The refetch after the command no longer returns the Application.
      applicationMocks.withdraw.mockImplementationOnce(async () => {
        applicationMocks.applicationsQuery.data = [];
        return null;
      });
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(
        screen.getByRole('button', { name: 'Retrage aplicația' }),
      );
      await user.click(screen.getByRole('button', { name: 'Confirmă' }));

      expect(applicationMocks.withdraw).toHaveBeenCalledWith({
        kind: 'withdraw',
        applicationId: 501,
      });
      expect(
        await screen.findByText('Nicio cerere în așteptare.'),
      ).toBeInTheDocument();
      const joining = screen.getByTestId('joining-section');
      expect(within(joining).getByRole('status')).toHaveTextContent(
        'Cererea pentru Echipa Media a fost retrasă.',
      );
      expect(
        screen.getByRole('link', { name: 'Aplică la un grup' }),
      ).toHaveFocus();
    });

    it('says so when no Application is pending', () => {
      applicationMocks.applicationsQuery.data = [];
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(
        screen.getByText('Nicio cerere în așteptare.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retrage aplicația' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Aplică la un grup' }),
      ).toBeInTheDocument();
    });

    it('at level 5 stays Grupuri with none of the joining parts', () => {
      authMock.claims = {
        member_role: 'bce',
        member_level: 5,
        group_ids: [10],
      };
      setTestProfile({ ...mockProfile, role: 'bce' });
      render(<ProfileScreen />, { wrapper: wrapper() });

      const card = screen.getByTestId('groups-card');
      expect(
        within(card).getByRole('heading', { name: 'Grupuri' }),
      ).toBeInTheDocument();
      expect(within(card).getByText('Educațional')).toBeInTheDocument();
      expect(screen.queryByText('Grupurile mele')).not.toBeInTheDocument();
      expect(screen.queryByTestId('joining-section')).not.toBeInTheDocument();
      expect(screen.queryByText('Cereri în așteptare')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Aplică la un grup' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retrage aplicația' }),
      ).not.toBeInTheDocument();
      // A leader's Profil never asks for Applications at all.
      expect(applicationMocks.useGroupApplications).not.toHaveBeenCalled();
    });
  });

  it('imports no Ionic anywhere in the Profil screens (#699)', () => {
    const sources = import.meta.glob<string>('./*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const files = Object.keys(sources).filter(
      (path) => !path.endsWith('.test.tsx'),
    );
    expect(files).toContain('./ProfileScreen.tsx');
    for (const path of files)
      expect(sources[path], path).not.toMatch(/@ionic\//);
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
