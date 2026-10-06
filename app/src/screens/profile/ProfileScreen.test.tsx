import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { Database } from '../../lib/database.types';
import type { GroupApplication } from '../../queries/group-applications';
import type {
  Group,
  GroupMemberRow,
  MemberGroup,
} from '../../queries/reference';
import type { PromotionState } from '../../components/profile/promotion-state';
import ProfileScreen from './ProfileScreen';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
// Promotion progress (#634) has its own suite; here it is only a slot, and
// the page only asks whether the panel exists (#824).
const promotionMock = vi.hoisted(() => ({
  state: { kind: 'hidden' } as PromotionState,
}));
vi.mock('../../components/profile/promotion-state', () => ({
  usePromotionProgressState: () => promotionMock.state,
}));
vi.mock('../../components/profile/PromotionProgress', () => ({
  PromotionPanel: ({ totalPoints }: { totalPoints?: number }) => (
    <section
      aria-label="Punctaj și promovare"
      data-testid="promotion-progress-slot"
      data-total={totalPoints}
    />
  ),
  PointsTotal: ({ points }: { points: number }) => <p>{points} puncte</p>,
}));

// Groups that accept Applications (#859 B42): none unless a test adds one.
const adminGroupsMock = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../queries/groups-admin', () => ({
  useAdminGroups: () => adminGroupsMock,
}));

// #824 (decision D1): the organization setting naming the board Group.
const orgSettingsMock = vi.hoisted(() => ({
  data: new Map<string, string | null>([['board_group_id', '99']]),
  isPending: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
  enabled: [] as boolean[],
}));
vi.mock('../../queries/org-settings', () => ({
  useOrgSettings: ({ enabled = true }: { enabled?: boolean } = {}) => {
    orgSettingsMock.enabled.push(enabled);
    return orgSettingsMock;
  },
}));

const authMock = vi.hoisted(() => ({
  claims: null as MemberClaims | null,
  session: { user: { id: 'p1' } },
  signOut: vi.fn(async () => undefined),
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    claims: authMock.claims,
    session: authMock.session,
    loading: false,
    signOut: authMock.signOut,
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

/* #633: the Role timeline is its own component with its own spec; here it
   only has to be mounted. Pending by default so the other assertions see the
   page without it. */
const roleHistoryMock = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  isPending: true,
  isError: false,
}));

vi.mock('../../queries/role-history', () => ({
  useMyRoleHistory: () => roleHistoryMock,
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
    ['moderator', { name: 'Moderator', level: 6 }],
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
      membershipRows: [] as GroupMemberRow[],
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

    roleHistoryMock.data = undefined;
    roleHistoryMock.isPending = true;

    pointsQueryMock.data = 42;
    adminGroupsMock.data = [];
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
    groupsQueryMock.membershipRows = [];
    groupsQueryMock.refetch.mockClear();

    promotionMock.state = { kind: 'hidden' };
    orgSettingsMock.data = new Map([['board_group_id', '99']]);
    orgSettingsMock.isPending = false;
    orgSettingsMock.isError = false;
    orgSettingsMock.enabled = [];
  });

  it('A Voluntar sees header, contact, edit, Groups, points total, and the theme toggle', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Header
    expect(
      screen.getByRole('heading', { name: /maria enache/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Voluntar')).toBeInTheDocument();
    expect(screen.getByText(/membru din/i)).toBeInTheDocument();

    // Membership Status is NOT shown (ruling R2)
    expect(screen.queryByText('Activ')).not.toBeInTheDocument();

    // Contact
    const contact = screen.getByRole('region', { name: 'Date de contact' });
    expect(within(contact).getByText('E-mail')).toBeInTheDocument();
    expect(within(contact).getByText('maria@osubb.ro')).toBeInTheDocument();
    expect(within(contact).getByText('Telefon')).toBeInTheDocument();
    // #824: no email form on the page itself; it lives in the sheet.
    expect(screen.queryByLabelText('Adresa nouă')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Schimbă adresa' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('0722334455')).toBeInTheDocument();
    expect(
      screen.getByText(
        /numărul de telefon este vizibil doar pentru tine, BCE și BC./i,
      ),
    ).toBeInTheDocument();

    // Edit button
    expect(
      screen.getByRole('button', { name: 'Editează profilul' }),
    ).toBeInTheDocument();

    // Groups
    expect(
      screen.getByRole('region', { name: 'Grupurile mele' }),
    ).toBeInTheDocument();
    // Voluntar does not see Adunarea Generală chip
    expect(screen.queryByText('Adunarea Generală')).not.toBeInTheDocument();

    // Points total (Punctaj personal)
    expect(screen.getByTestId('personal-points-card')).toBeInTheDocument();
    expect(screen.getByText('Punctaj personal')).toBeInTheDocument();
    expect(screen.getByText('42 puncte')).toBeInTheDocument();

    // Promotion progress (#634): hidden here, so its panel is absent.
    expect(
      screen.queryByTestId('promotion-progress-slot'),
    ).not.toBeInTheDocument();

    // Theme toggle
    expect(
      screen.getByRole('button', { name: /temă întunecată/i }),
    ).toBeInTheDocument();

    // The Privacy Notice, always one tap away (#771)
    expect(
      screen.getByRole('link', { name: 'Politica de confidențialitate' }),
    ).toHaveAttribute('href', '/confidentialitate');
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
    // B40: plain membership carries no badge; only a Group Role does.
    expect(screen.queryByText('Membru')).not.toBeInTheDocument();
  });

  it('lists the Adunarea Generală joined by Automatic Membership, marked "Automat" (#929)', () => {
    groupsQueryMock.data = [
      ...defaultMemberGroups,
      {
        id: 62,
        name: 'Adunarea Generală',
        short: 'AG',
        color: '#284C93',
        category: 'team',
        group_role: 'member',
        position_title: null,
        role_label: 'Automat',
        automatic: true,
      },
    ];
    render(<ProfileScreen />, { wrapper: wrapper() });

    const card = screen.getByTestId('groups-card');
    const link = within(card).getByRole('link', { name: 'Adunarea Generală' });
    expect(link).toHaveAttribute('href', '/grupuri/62');
    const row = link.closest('[data-slot="list-row"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Automat')).toBeInTheDocument();
    // A plain explicit membership still carries no badge (B40).
    expect(within(card).queryByText('Membru')).not.toBeInTheDocument();
  });

  it('each Grupurile mele row opens its Group page (navigation D8)', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    const card = screen.getByTestId('groups-card');
    expect(
      within(card).getByRole('link', { name: 'Educațional' }),
    ).toHaveAttribute('href', '/grupuri/10');
    expect(
      within(card).getByRole('link', { name: 'Echipa IT' }),
    ).toHaveAttribute('href', '/grupuri/20');
    expect(
      within(card).getByRole('link', { name: 'Gala OSUBB' }),
    ).toHaveAttribute('href', '/grupuri/30');
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

    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));

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
      screen.getByRole('heading', { level: 3, name: 'Maria Enache' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profile-full-name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));
    await user.type(screen.getByLabelText('Pseudonim'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Mara' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('profile-full-name')).toHaveTextContent(
      'Maria Enache',
    );
  });

  // F-19 (#893): the sheet closed with no word that anything was saved.
  it('a successful save closes the sheet and Profil says the profile was updated', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.queryByText('Profilul a fost actualizat.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));
    await user.type(screen.getByLabelText('Pseudonim'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    const receipt = await screen.findByText('Profilul a fost actualizat.');
    expect(receipt).toHaveAttribute('role', 'status');
    expect(
      screen.queryByRole('heading', { name: /editează profilul/i }),
    ).not.toBeInTheDocument();

    // Opening the sheet again starts a new edit: the old receipt goes.
    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));
    expect(
      screen.queryByText('Profilul a fost actualizat.'),
    ).not.toBeInTheDocument();
  });

  it('a failed save keeps the sheet open and shows no receipt', async () => {
    updateProfileMock.mutateAsync.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<ProfileScreen />, { wrapper: wrapper() });

    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));
    await user.type(screen.getByLabelText('Pseudonim'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(
      await screen.findByText('Nu am putut salva modificările.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Profilul a fost actualizat.'),
    ).not.toBeInTheDocument();
  });

  it('shows the Nickname as the heading with the full name underneath', () => {
    setTestProfile({ ...mockProfile, nickname: 'Mara' });
    render(<ProfileScreen />, { wrapper: wrapper() });

    const heading = screen.getByRole('heading', { level: 3, name: 'Mara' });
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
      screen.getByRole('heading', { level: 3, name: 'Maria Enache' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profile-full-name')).not.toBeInTheDocument();
  });

  describe('Grupurile mele (R18)', () => {
    /** A Group that takes Applications from level 0 (as Grupuri reads it). */
    function openGroup(id: number) {
      return {
        id,
        status: 'active',
        is_private: false,
        automatic_membership: false,
        accepts_applications: true,
        application_level: 0,
        min_level: 0,
      };
    }

    it('at level 1 shows the memberships, a pending Application with withdraw, and the button to /grupuri', async () => {
      adminGroupsMock.data = [openGroup(50)];
      render(<ProfileScreen />, { wrapper: wrapper() });

      const card = screen.getByRole('region', { name: 'Grupurile mele' });
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
      adminGroupsMock.data = [openGroup(50)];
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
      // B41: the heading leaves with the last pending Application.
      await waitFor(() =>
        expect(
          screen.queryByText('Cereri în așteptare'),
        ).not.toBeInTheDocument(),
      );
      const joining = screen.getByTestId('joining-section');
      expect(within(joining).getByRole('status')).toHaveTextContent(
        'Cererea pentru Echipa Media a fost retrasă.',
      );
      expect(
        screen.getByRole('link', { name: 'Aplică la un grup' }),
      ).toHaveFocus();
    });

    it('with no Group left to apply to, focus lands on the confirmation', async () => {
      const user = userEvent.setup();
      applicationMocks.withdraw.mockImplementationOnce(async () => {
        applicationMocks.applicationsQuery.data = [];
        return null;
      });
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(
        screen.getByRole('button', { name: 'Retrage aplicația' }),
      );
      await user.click(screen.getByRole('button', { name: 'Confirmă' }));

      await waitFor(() =>
        expect(
          screen.getByText('Cererea pentru Echipa Media a fost retrasă.'),
        ).toHaveFocus(),
      );
    });

    it('hides an empty "Cereri în așteptare" (B41) and keeps the apply link while a Group accepts', () => {
      applicationMocks.applicationsQuery.data = [];
      adminGroupsMock.data = [openGroup(50)];
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(screen.queryByText('Cereri în așteptare')).not.toBeInTheDocument();
      expect(screen.queryByText(/nicio cerere/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Aplică la un grup' }),
      ).toHaveAttribute('href', '/grupuri');
    });

    it('offers "Aplică la un grup" only when some Group would take the Application (B42)', () => {
      applicationMocks.applicationsQuery.data = [];
      // Closed, private, above the level, or already joined / applied to.
      adminGroupsMock.data = [
        { ...openGroup(51), accepts_applications: false },
        { ...openGroup(52), is_private: true },
        { ...openGroup(53), application_level: 3 },
        openGroup(10),
      ];
      groupsQueryMock.membershipRows = [
        { group_id: 10, group_role: 'member', position_title: null },
      ];
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(
        screen.queryByRole('link', { name: 'Aplică la un grup' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('joining-section')).not.toBeInTheDocument();
      groupsQueryMock.membershipRows = [];
    });

    it('at level 5 Grupurile mele lists the Groups, the Adunarea Generală included, with none of the joining parts (#824, #929)', () => {
      authMock.claims = {
        member_role: 'bce',
        member_level: 5,
        group_ids: [10],
      };
      setTestProfile({ ...mockProfile, role: 'bce' });
      groupsQueryMock.data = [
        ...defaultMemberGroups,
        {
          id: 62,
          name: 'Adunarea Generală',
          short: 'AG',
          color: '#284C93',
          category: 'team',
          group_role: 'member',
          position_title: null,
          role_label: 'Automat',
          automatic: true,
        },
      ];
      render(<ProfileScreen />, { wrapper: wrapper() });

      // #929 (Alex, 2026-09-29): BCE belongs to the Adunarea Generală by Role.
      const card = screen.getByTestId('groups-card');
      expect(
        within(card).getByRole('link', { name: 'Adunarea Generală' }),
      ).toHaveAttribute('href', '/grupuri/62');
      expect(within(card).getByText('Automat')).toBeInTheDocument();
      expect(screen.getByTestId('board-title')).toBeInTheDocument();
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

    it('BC and the Moderator, members of every Group, get no Grupurile mele (R32)', () => {
      for (const role of ['bc', 'moderator'] as const) {
        authMock.claims = {
          member_role: role,
          member_level: role === 'bc' ? 6 : 9,
          group_ids: [10],
        };
        setTestProfile({ ...mockProfile, role });
        const { unmount } = render(<ProfileScreen />, { wrapper: wrapper() });
        expect(screen.queryByTestId('groups-card')).not.toBeInTheDocument();
        expect(screen.queryByText('Grupurile mele')).not.toBeInTheDocument();
        unmount();
      }
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

  it('mounts the Role timeline from its second Role row (#633, #859 B39)', () => {
    roleHistoryMock.data = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2025-04-01T08:00:00Z',
        actor_kind: 'automatic',
        changed_by: null,
      },
    ];
    roleHistoryMock.isPending = false;

    render(<ProfileScreen />, { wrapper: wrapper() });

    const timeline = screen.getByRole('region', {
      name: 'Parcursul organizațional',
    });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
  });

  it('hides Parcursul organizațional while it has one Role row (B39)', () => {
    roleHistoryMock.data = [];
    roleHistoryMock.isPending = false;

    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.queryByRole('region', { name: 'Parcursul organizațional' }),
    ).not.toBeInTheDocument();
  });

  it('waits for the history before drawing Parcursul organizațional', () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    expect(
      screen.queryByRole('region', { name: 'Parcursul organizațional' }),
    ).not.toBeInTheDocument();
  });

  describe('panels (#824, R27)', () => {
    /** Every panel's name, in document (and so 375 px reading) order. */
    const panelNames = () =>
      [
        ...document.querySelectorAll(
          '[data-slot="panel"], [data-testid="promotion-progress-slot"]',
        ),
      ].map(
        (panel) =>
          panel.getAttribute('aria-label') ??
          panel.querySelector('h2')?.textContent,
      );
    const gridColumns = () =>
      [...document.querySelectorAll('[data-slot="page-grid"]')].map((grid) =>
        grid.getAttribute('data-columns'),
      );

    it('below BCE: Identitate · Contact; Grupuri beside the points panel; Notificări beside Email over Confidențialitate', () => {
      promotionMock.state = { kind: 'loading' };
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toEqual([
        'Identitate',
        'Date de contact',
        'Grupurile mele',
        'Punctaj și promovare',
        'Notificări pe acest dispozitiv',
        'Email zilnic',
        'Confidențialitate',
      ]);
      // Two columns from md at every row (P2): no 1-column page at 768.
      expect(gridColumns()).toEqual(['2', '2', '2']);
      // B38: one points panel — the promotion panel carries the total.
      expect(screen.queryByText('Punctaj personal')).not.toBeInTheDocument();
      expect(screen.getByTestId('promotion-progress-slot')).toHaveAttribute(
        'data-total',
        '42',
      );
      expect(screen.queryByText('Funcția în OSUBB')).not.toBeInTheDocument();
      // The page never asks for the board setting below BCE.
      expect(orgSettingsMock.enabled.every((enabled) => !enabled)).toBe(true);
    });

    it('stacks the small panels in one cell beside Grupurile mele and beside Notificări (P1)', () => {
      promotionMock.state = { kind: 'loading' };
      roleHistoryMock.data = [
        {
          from_role: 'recrut',
          to_role: 'voluntar',
          created_at: '2025-04-01T08:00:00Z',
          actor_kind: 'automatic',
          changed_by: null,
        },
      ];
      roleHistoryMock.isPending = false;
      render(<ProfileScreen />, { wrapper: wrapper() });

      const [, rowTwo, rowThree] = document.querySelectorAll(
        '[data-slot="page-grid"]',
      );
      expect(rowTwo?.children).toHaveLength(2);
      const stack = rowTwo?.children[1];
      expect(
        within(stack as HTMLElement).getByTestId('promotion-progress-slot'),
      ).toBeInTheDocument();
      expect(
        within(stack as HTMLElement).getByRole('region', {
          name: 'Parcursul organizațional',
        }),
      ).toBeInTheDocument();
      expect(rowThree?.children).toHaveLength(2);
      expect(
        within(rowThree?.children[1] as HTMLElement).getByRole('region', {
          name: 'Confidențialitate',
        }),
      ).toBeInTheDocument();
      // #876: unrelated panels keep their own height.
      expect(rowTwo).not.toHaveAttribute('data-equal-heights');
    });

    it('without a Promovare to show, Punctaj personal carries the total', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toContain('Punctaj personal');
      expect(panelNames()).not.toContain('Punctaj și promovare');
      expect(screen.getByTestId('personal-points-card')).toHaveTextContent(
        '42 puncte',
      );
    });

    it('at level >= 5: Funcția în OSUBB in row 2, no points, and a description without "punctaj" (B45)', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toEqual([
        'Identitate',
        'Date de contact',
        'Funcția în OSUBB',
        'Notificări pe acest dispozitiv',
        'Email zilnic',
        'Confidențialitate',
      ]);
      expect(gridColumns()).toEqual(['2', '2', '2']);
      expect(screen.getByText('Biroul de Conducere')).toBeInTheDocument();
      expect(
        screen.getByText('Informații personale și setări de cont'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/punctaj/i)).not.toBeInTheDocument();
    });

    it('Funcția în OSUBB shows the title from the board Group, then the Role', () => {
      authMock.claims = { member_role: 'bce', member_level: 5, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bce' });
      groupsQueryMock.membershipRows = [
        { group_id: 10, group_role: 'manager', position_title: null },
        // A title on another Group is not the board title.
        {
          group_id: 20,
          group_role: 'responsible',
          position_title: 'Coordonator Tehnic',
        },
        {
          group_id: 99,
          group_role: 'responsible',
          position_title: 'Coordonator IT',
        },
      ];
      render(<ProfileScreen />, { wrapper: wrapper() });

      const panel = screen.getByRole('region', { name: 'Funcția în OSUBB' });
      expect(
        within(panel).getByText('Biroul de Conducere Extins'),
      ).toBeInTheDocument();
      expect(within(panel).getByText('Coordonator IT')).toBeInTheDocument();
      // B46: the title is the information; no "BCE · OSUBB" line under it.
      expect(within(panel).queryByText(/· OSUBB/)).not.toBeInTheDocument();
      expect(
        within(panel).queryByText('Funcția nu este setată încă.'),
      ).not.toBeInTheDocument();
      expect(orgSettingsMock.enabled).toContain(true);
      // #963: the Identitate chip names the Role by the Board Title too.
      const identity = screen.getByRole('region', { name: 'Identitate' });
      expect(within(identity).getByText('Coordonator IT')).toBeInTheDocument();
      expect(within(identity).queryByText('BCE')).not.toBeInTheDocument();
    });

    it('Funcția în OSUBB falls back to the Role when no title is set', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      groupsQueryMock.membershipRows = [
        {
          group_id: 20,
          group_role: 'responsible',
          position_title: 'Coordonator Tehnic',
        },
        // Only a Responsible row on the board carries a board title.
        { group_id: 99, group_role: 'member', position_title: 'Casier' },
      ];
      render(<ProfileScreen />, { wrapper: wrapper() });

      const panel = screen.getByRole('region', { name: 'Funcția în OSUBB' });
      expect(within(panel).getByText('BC')).toBeInTheDocument();
      expect(
        within(panel).getByText('Funcția nu este setată încă.'),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByText(/Coordonator|Casier/),
      ).not.toBeInTheDocument();
      // No title: the Identitate chip keeps the Role (#963).
      const identity = screen.getByRole('region', { name: 'Identitate' });
      expect(within(identity).getByText('BC')).toBeInTheDocument();
    });

    // F-7 (#893, Alex 2026-09-29): the Moderator is not a board position.
    it('a Moderator sees only "Moderator": no "not set" line, no Biroul de Conducere eyebrow', () => {
      authMock.claims = {
        member_role: 'moderator',
        member_level: 6,
        group_ids: [],
      };
      setTestProfile({ ...mockProfile, role: 'moderator' });
      render(<ProfileScreen />, { wrapper: wrapper() });

      const panel = screen.getByRole('region', { name: 'Funcția în OSUBB' });
      expect(within(panel).getByTestId('board-title')).toHaveTextContent(
        /^Moderator$/,
      );
      expect(
        within(panel).queryByText('Funcția nu este setată încă.'),
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByText(/Biroul de Conducere/),
      ).not.toBeInTheDocument();
      expect(
        panel.querySelector('[data-slot="section-eyebrow"]'),
      ).not.toBeInTheDocument();
    });

    it('Funcția în OSUBB falls back to the Role when the board setting is unset', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      orgSettingsMock.data = new Map([['board_group_id', null]]);
      groupsQueryMock.membershipRows = [
        {
          group_id: 99,
          group_role: 'responsible',
          position_title: 'Președinte',
        },
      ];
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(
        screen.getByText('Funcția nu este setată încă.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Președinte')).not.toBeInTheDocument();
    });

    it('the Adunarea Generală badge sits in Identitate, for BC too', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      render(<ProfileScreen />, { wrapper: wrapper() });

      const identity = screen.getByRole('region', { name: 'Identitate' });
      expect(
        within(identity).getByText('Adunarea Generală'),
      ).toBeInTheDocument();
    });

    it('Editează on Date de contact opens the sheet with the email change inside', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(
        screen.getByRole('button', { name: 'Editează datele de contact' }),
      );
      const sheet = screen.getByRole('dialog');
      expect(
        within(sheet).getByRole('heading', {
          name: 'Schimbă adresa de email',
        }),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByRole('button', { name: 'Schimbă adresa' }),
      ).toBeInTheDocument();
    });
  });

  // Nested so the screen's own setup runs first: alone, it once depended on
  // the order of the tests above it.
  describe('one quiet sign-out at the foot of Profil (R41)', () => {
    const LINK = 'Deconectează-te de pe acest dispozitiv';
    const CONFIRM = 'Deconectează-te';

    beforeEach(() => {
      authMock.signOut.mockReset();
      authMock.signOut.mockResolvedValue(undefined);
    });

    it('keeps the header free of sign-out and puts one link after everything else', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      // The header keeps the theme switch only.
      const header = screen
        .getByRole('heading', { level: 1, name: 'Profilul meu' })
        .closest<HTMLElement>('[data-slot="page-header"]');
      if (!header) throw new Error('no page header');
      expect(
        within(header).getByRole('button', { name: 'Temă întunecată' }),
      ).toBeInTheDocument();
      expect(
        within(header).queryByRole('button', { name: /deconect/i }),
      ).toBeNull();

      const signOuts = screen.getAllByRole('button', { name: /deconect/i });
      expect(signOuts).toHaveLength(1);
      const [link] = signOuts as [HTMLElement];
      expect(link).toHaveAccessibleName(LINK);
      // Below the last panel on the page.
      const lastPanel = screen.getByRole('region', {
        name: 'Confidențialitate',
      });
      expect(
        lastPanel.compareDocumentPosition(link) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(lastPanel).not.toContainElement(link);
    });

    it('asks first, then signs out', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(screen.getByRole('button', { name: LINK }));

      const dialog = screen.getByRole('dialog', {
        name: 'Te deconectezi de pe acest dispozitiv?',
      });
      expect(dialog).toHaveTextContent(
        'Vei avea nevoie de un nou link de conectare pe email.',
      );
      expect(authMock.signOut).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: CONFIRM }));

      expect(authMock.signOut).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('does nothing on Renunță', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(screen.getByRole('button', { name: LINK }));
      await user.click(screen.getByRole('button', { name: 'Renunță' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(authMock.signOut).not.toHaveBeenCalled();
    });

    it('keeps a failed sign-out in the dialog and unlocks a retry', async () => {
      const user = userEvent.setup();
      authMock.signOut.mockRejectedValueOnce(new Error('offline'));
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(screen.getByRole('button', { name: LINK }));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: CONFIRM }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Nu te-am putut deconecta. Încearcă din nou.',
      );
      expect(within(dialog).queryByText(/offline/)).toBeNull();
      const retry = within(dialog).getByRole('button', { name: CONFIRM });
      expect(retry).toBeEnabled();

      await user.click(retry);
      expect(authMock.signOut).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('forgets an earlier failure when the dialog opens again', async () => {
      const user = userEvent.setup();
      authMock.signOut.mockRejectedValueOnce(new Error('offline'));
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(screen.getByRole('button', { name: LINK }));
      await user.click(screen.getByRole('button', { name: CONFIRM }));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Renunță' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await user.click(screen.getByRole('button', { name: LINK }));
      expect(
        within(screen.getByRole('dialog')).queryByRole('alert'),
      ).toBeNull();
    });
  });
});
