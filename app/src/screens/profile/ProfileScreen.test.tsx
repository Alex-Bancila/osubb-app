import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { swipe } from '../../test/swipe';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
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
    university: 'Universitatea Babeș-Bolyai' as string | null,
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

/** `entry` is the URL Profil opens at: `?tab=` chooses the tab. */
function wrapper(queryClient = new QueryClient(), entry = '/profil') {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

/** Profil opened on one of its tabs. */
function onTab(tab: 'cont' | 'notificari' | 'preferinte') {
  return wrapper(undefined, `/profil?tab=${tab}`);
}

/** The page's header: avatar, name, Role chip, "Membru din …", the buttons. */
function identity() {
  const block = document.querySelector<HTMLElement>(
    '[data-slot="profile-identity"]',
  );
  if (!block) throw new Error('no identity header');
  return block;
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

  it('A Voluntar sees header, contact, edit, Groups, points total, and the theme toggle', async () => {
    render(<ProfileScreen />, { wrapper: wrapper() });

    // Header
    expect(
      screen.getByRole('heading', { name: /maria enache/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Voluntar')).toBeInTheDocument();
    expect(screen.getByText(/membru din/i)).toBeInTheDocument();

    // Membership Status is NOT shown (ruling R2)
    expect(screen.queryByText('Activ')).not.toBeInTheDocument();

    // Contact and Universitate (R58)
    const contact = screen.getByRole('region', { name: 'Date personale' });
    expect(within(contact).getByText('E-mail')).toBeInTheDocument();
    expect(within(contact).getByText('maria@osubb.ro')).toBeInTheDocument();
    expect(within(contact).getByText('Telefon')).toBeInTheDocument();
    expect(within(contact).getByText('Universitate')).toBeInTheDocument();
    expect(
      within(contact).getByText('Universitatea Babeș-Bolyai'),
    ).toBeInTheDocument();
    // #824: no email form on the page itself; it lives in the sheet.
    expect(screen.queryByLabelText('Adresa nouă')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Schimbă adresa' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('0722334455')).toBeInTheDocument();
    // Who sees the phone is said once, behind the "i" beside Telefon.
    expect(
      screen.queryByText(/numărul de telefon este vizibil doar/i),
    ).toBeNull();
    await userEvent.click(
      within(contact).getByRole('button', {
        name: 'Despre numărul de telefon',
      }),
    );
    expect(
      await screen.findByText(
        /numărul de telefon este vizibil doar pentru tine, BCE și BC./i,
      ),
    ).toBeVisible();
    await userEvent.keyboard('{Escape}');

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
  });

  it('keeps the Privacy Notice one tap away, on Preferințe (#771)', () => {
    render(<ProfileScreen />, { wrapper: onTab('preferinte') });

    const link = screen.getByRole('link', {
      name: 'Politica de confidențialitate',
    });
    expect(link).toHaveAttribute('href', '/confidentialitate');
    // A row that opens: the words, what they lead to, and a chevron.
    const row = link.closest('[data-slot="list-row"]');
    expect(row).toHaveTextContent(
      'Ce date folosește aplicația, cine le vede și ce drepturi ai.',
    );
    expect(
      row?.querySelector('[data-slot="list-row-action"] svg'),
    ).not.toBeNull();
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

    await user.type(screen.getByLabelText('Poreclă (opțional)'), 'Mara');
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
      screen.getByRole('heading', { level: 1, name: 'Maria Enache' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profile-full-name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editează profilul' }));
    await user.type(screen.getByLabelText('Poreclă (opțional)'), 'Mara');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mara' }),
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
    await user.type(screen.getByLabelText('Poreclă (opțional)'), 'Mara');
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
    await user.type(screen.getByLabelText('Poreclă (opțional)'), 'Mara');
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

    const heading = screen.getByRole('heading', { level: 1, name: 'Mara' });
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
      screen.getByRole('heading', { level: 1, name: 'Maria Enache' }),
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

  it('says Necompletată, in italics, when the Universitate was never recorded (R58)', () => {
    setTestProfile({
      ...mockProfile,
      university: null,
    });

    render(<ProfileScreen />, { wrapper: wrapper() });

    const row = screen.getByText('Universitate').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('UniversitateNecompletată');
    expect(within(row).getByText('Necompletată')).toHaveClass('italic');
    // Read-only: BC sets it on the Member's page, not the Member.
    expect(screen.queryByRole('textbox', { name: /universitate/i })).toBeNull();
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

    it('below BCE, Cont holds Date personale over Grupurile mele beside the points panel', () => {
      promotionMock.state = { kind: 'loading' };
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toEqual([
        'Date personale',
        'Grupurile mele',
        'Punctaj și promovare',
      ]);
      // Two columns from md (P2): no 1-column page at 768.
      expect(gridColumns()).toEqual(['2']);
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

    it('Notificări holds push on this device, and no daily email', () => {
      render(<ProfileScreen />, { wrapper: onTab('notificari') });

      expect(panelNames()).toEqual(['Notificări pe acest dispozitiv']);
      expect(screen.queryByText(/email zilnic|rezumat zilnic/i)).toBeNull();
      // What arrives as push sits with the device's switch.
      expect(
        within(
          screen.getByRole('region', {
            name: 'Notificări pe acest dispozitiv',
          }),
        ).getByRole('group', { name: 'Ce primești ca notificare push' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: 'Rezumat zilnic pe email' }),
      ).toBeNull();
    });

    it('Preferințe holds Confidențialitate, then the way out', () => {
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

      expect(panelNames()).toEqual(['Confidențialitate']);
    });

    it('no panel carries an eyebrow over its title', () => {
      for (const tab of ['cont', 'notificari', 'preferinte'] as const) {
        const { unmount } = render(<ProfileScreen />, { wrapper: onTab(tab) });
        expect(
          document.querySelectorAll('[data-slot="panel"]'),
        ).not.toHaveLength(0);
        expect(
          document.querySelector('[data-slot="section-eyebrow"]'),
        ).toBeNull();
        unmount();
      }
    });

    it('stacks the small panels in one column beside the other (P1)', () => {
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

      const [grid] = document.querySelectorAll('[data-slot="page-grid"]');
      expect(grid?.children).toHaveLength(2);
      const [left, right] = Array.from(grid?.children ?? []) as [
        HTMLElement,
        HTMLElement,
      ];
      expect(
        within(left).getByRole('region', { name: 'Date personale' }),
      ).toBeInTheDocument();
      expect(
        within(left).getByRole('region', { name: 'Grupurile mele' }),
      ).toBeInTheDocument();
      expect(
        within(right).getByTestId('promotion-progress-slot'),
      ).toBeInTheDocument();
      expect(
        within(right).getByRole('region', {
          name: 'Parcursul organizațional',
        }),
      ).toBeInTheDocument();
      // #876: unrelated panels keep their own height.
      expect(grid).not.toHaveAttribute('data-equal-heights');
    });

    it('without a Promovare to show, Punctaj personal carries the total', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toContain('Punctaj personal');
      expect(panelNames()).not.toContain('Punctaj și promovare');
      expect(screen.getByTestId('personal-points-card')).toHaveTextContent(
        '42 puncte',
      );
    });

    it('at level >= 5: Funcția în OSUBB on Cont, and no points on any tab (B45)', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      const { unmount } = render(<ProfileScreen />, { wrapper: wrapper() });

      expect(panelNames()).toEqual(['Date personale', 'Funcția în OSUBB']);
      expect(gridColumns()).toEqual(['2']);
      expect(screen.getByText('Biroul de Conducere')).toBeInTheDocument();
      expect(screen.queryByText(/punctaj/i)).not.toBeInTheDocument();
      unmount();

      for (const tab of ['notificari', 'preferinte'] as const) {
        const view = render(<ProfileScreen />, { wrapper: onTab(tab) });
        expect(screen.queryByText(/punctaj/i)).not.toBeInTheDocument();
        view.unmount();
      }
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
      // The board is named once, under the title — not as an eyebrow.
      expect(
        within(panel).getByText('Biroul de Conducere Extins'),
      ).not.toHaveAttribute('data-slot', 'section-eyebrow');
      expect(within(panel).getByText('Coordonator IT')).toBeInTheDocument();
      // B46: the title is the information; no "BCE · OSUBB" line under it.
      expect(within(panel).queryByText(/· OSUBB/)).not.toBeInTheDocument();
      expect(
        within(panel).queryByText('Funcția nu este setată încă.'),
      ).not.toBeInTheDocument();
      expect(orgSettingsMock.enabled).toContain(true);
      // #963: the header's chip names the Role by the Board Title too.
      expect(
        within(identity()).getByText('Coordonator IT'),
      ).toBeInTheDocument();
      expect(within(identity()).queryByText('BCE')).not.toBeInTheDocument();
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
      // No title: the header's chip keeps the Role (#963).
      expect(within(identity()).getByText('BC')).toBeInTheDocument();
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

    it('the Adunarea Generală badge sits in the header, for BC too', () => {
      authMock.claims = { member_role: 'bc', member_level: 6, group_ids: [] };
      setTestProfile({ ...mockProfile, role: 'bc' });
      render(<ProfileScreen />, { wrapper: wrapper() });

      expect(
        within(identity()).getByText('Adunarea Generală'),
      ).toBeInTheDocument();
    });

    it('the pencil on Date personale opens the sheet with the email change inside', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: wrapper() });

      const pencil = screen.getByRole('button', {
        name: 'Editează datele personale',
      });
      // An icon button in the block's header, not a full-width one in its box.
      expect(pencil).toHaveTextContent('');
      expect(pencil).toHaveClass('size-11');
      expect(pencil.closest('[data-slot="section-header"]')).not.toBeNull();
      await user.click(pencil);
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

  describe('the identity header', () => {
    it('is the page header: the name as the h1, the Role chip, "Membru din" and two icon buttons', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      const header = identity();
      expect(
        within(header).getByRole('heading', { level: 1, name: 'Maria Enache' }),
      ).toBeInTheDocument();
      // No "Profilul meu" title and no Identitate panel any more.
      expect(screen.queryByText('Profilul meu')).not.toBeInTheDocument();
      expect(screen.queryByText('Identitate')).not.toBeInTheDocument();
      expect(within(header).getByText('Voluntar')).toHaveClass('role-badge');
      // The day, the month and the year: no weekday on a milestone.
      expect(
        within(header).getByText('Membru din 1 octombrie 2024'),
      ).toBeInTheDocument();

      for (const name of ['Editează profilul', 'Temă întunecată']) {
        const button = within(header).getByRole('button', { name });
        // An icon alone; the words are its accessible name.
        expect(button).toHaveTextContent('');
        expect(button.querySelector('svg')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
        expect(button).toHaveClass('size-11');
      }
    });

    it('names the theme button by the theme it switches to', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: wrapper() });

      await user.click(screen.getByRole('button', { name: 'Temă întunecată' }));
      expect(
        screen.getByRole('button', { name: 'Temă luminoasă' }),
      ).toBeInTheDocument();
    });

    it('stays above every tab', () => {
      for (const tab of ['cont', 'notificari', 'preferinte'] as const) {
        const { unmount } = render(<ProfileScreen />, { wrapper: onTab(tab) });
        expect(
          within(identity()).getByRole('heading', { level: 1 }),
        ).toHaveTextContent('Maria Enache');
        unmount();
      }
    });
  });

  describe('tabs (Cont · Notificări · Preferințe)', () => {
    const selected = () =>
      screen.getByRole('tab', { selected: true }).textContent;

    it('are a tablist of three, opening on Cont', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      const tabs = within(
        screen.getByRole('tablist', { name: 'Secțiunile profilului' }),
      ).getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        'Cont',
        'Notificări',
        'Preferințe',
      ]);
      // The pill track's segments: 36 px drawn, 44 px to tap.
      for (const tab of tabs)
        expect(tab).toHaveClass('min-h-[36px]', 'after:-inset-y-1');
      expect(selected()).toBe('Cont');
      // Only the open tab's panel is on the page.
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(
        within(screen.getByRole('tabpanel')).getByRole('region', {
          name: 'Date personale',
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('region', {
          name: 'Notificări pe acest dispozitiv',
        }),
      ).not.toBeInTheDocument();
    });

    it('opens the tab the URL names, so a link or a reload keeps it', () => {
      render(<ProfileScreen />, { wrapper: onTab('notificari') });

      expect(selected()).toBe('Notificări');
      expect(
        screen.getByRole('region', { name: 'Notificări pe acest dispozitiv' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Date personale' }),
      ).not.toBeInTheDocument();
    });

    it('falls back to Cont for a tab that does not exist', () => {
      render(<ProfileScreen />, {
        wrapper: wrapper(undefined, '/profil?tab=altceva'),
      });

      expect(selected()).toBe('Cont');
    });

    it('writes the chosen tab to the URL', async () => {
      const user = userEvent.setup();
      // The URL's query, printed where the test can read it.
      function Search() {
        return <output data-testid="search">{useLocation().search}</output>;
      }
      const search = () => screen.getByTestId('search').textContent;
      render(
        <>
          <ProfileScreen />
          <Search />
        </>,
        { wrapper: wrapper() },
      );

      await user.click(screen.getByRole('tab', { name: 'Preferințe' }));
      expect(search()).toBe('?tab=preferinte');
      expect(selected()).toBe('Preferințe');
      expect(
        screen.getByRole('region', { name: 'Confidențialitate' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Cont' }));
      expect(search()).toBe('?tab=cont');
      expect(
        screen.getByRole('region', { name: 'Date personale' }),
      ).toBeInTheDocument();
    });

    it.each([['#grupuri-preferate', 'Preferințe']])(
      'the older anchor %s opens %s, where its card now is',
      (hash, tab) => {
        render(<ProfileScreen />, {
          wrapper: wrapper(undefined, `/profil${hash}`),
        });

        expect(selected()).toBe(tab);
      },
    );

    it('shows contact data as rows: the name on the left, the value on the right', () => {
      render(<ProfileScreen />, { wrapper: wrapper() });

      const contact = screen.getByRole('region', { name: 'Date personale' });
      const rows = contact.querySelectorAll('[data-slot="setting-row"]');
      expect(Array.from(rows, (row) => row.textContent)).toEqual([
        'E-mailmaria@osubb.ro',
        'Telefon0722334455',
        'UniversitateUniversitatea Babeș-Bolyai',
      ]);
      for (const row of rows) {
        expect(row).toHaveClass('justify-between', 'min-h-11');
        expect(row.querySelector('[data-slot="setting-value"]')).toHaveClass(
          'text-right',
        );
      }
    });

    it('the saved receipt shows on whichever tab is open', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: onTab('notificari') });

      await user.click(
        screen.getByRole('button', { name: 'Editează profilul' }),
      );
      await user.type(screen.getByLabelText('Poreclă (opțional)'), 'Mara');
      await user.click(screen.getByRole('button', { name: /salvează/i }));

      expect(
        await screen.findByText('Profilul a fost actualizat.'),
      ).toHaveAttribute('role', 'status');
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
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

      // The header keeps the pencil and the theme switch only.
      expect(
        within(identity())
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label')),
      ).toEqual(['Editează profilul', 'Temă întunecată']);

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

    it('is on Preferințe only: the other tabs offer no way out', () => {
      for (const tab of ['cont', 'notificari'] as const) {
        const { unmount } = render(<ProfileScreen />, { wrapper: onTab(tab) });
        expect(screen.queryByRole('button', { name: /deconect/i })).toBeNull();
        unmount();
      }
    });

    it('asks first, then signs out', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

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

    it('keeps the link when Profil cannot load, the only way out (R41)', async () => {
      const user = userEvent.setup();
      profileQueryMock.isError = true;
      profileQueryMock.error = new Error('Database disconnected');
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

      expect(
        screen.getByText(/nu am putut încărca profilul/i),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: LINK }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: CONFIRM,
        }),
      );
      expect(authMock.signOut).toHaveBeenCalledTimes(1);
    });

    it('does nothing on Renunță', async () => {
      const user = userEvent.setup();
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

      await user.click(screen.getByRole('button', { name: LINK }));
      await user.click(screen.getByRole('button', { name: 'Renunță' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(authMock.signOut).not.toHaveBeenCalled();
    });

    it('keeps a failed sign-out in the dialog and unlocks a retry', async () => {
      const user = userEvent.setup();
      authMock.signOut.mockRejectedValueOnce(new Error('offline'));
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

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
      render(<ProfileScreen />, { wrapper: onTab('preferinte') });

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

it('moves between tabs with a finger swipe over the panel (2026-10-11)', async () => {
  render(<ProfileScreen />, { wrapper: wrapper() });
  swipe(await screen.findByRole('tabpanel'), 'left');
  expect(screen.getByRole('tab', { name: 'Notificări' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
