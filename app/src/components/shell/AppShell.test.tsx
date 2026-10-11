import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ useAuth: vi.fn(), signOut: vi.fn() }));
const queries = vi.hoisted(() => ({
  useMyProfile: vi.fn(),
  useRoles: vi.fn(),
  useMyGroups: vi.fn(),
  useOrgSettings: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
  useUnreadAnnouncementsCount: vi.fn(),
  useCapabilities: vi.fn(),
  usePendingDecisions: vi.fn(),
  useReadOpenedNotification: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
// The real `boardTitleFrom` rule is read from reference.ts, whose module also
// builds the shared client.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/profile', () => ({
  useMyProfile: queries.useMyProfile,
}));
vi.mock('../../queries/request-decisions', () => ({
  usePendingDecisions: queries.usePendingDecisions,
}));
vi.mock('../../queries/reference', async (original) => ({
  // The real D1 rule reads the Board Title off the caller's roster rows.
  boardTitleFrom: (await original<typeof import('../../queries/reference')>())
    .boardTitleFrom,
  useRoles: queries.useRoles,
  useMyGroups: queries.useMyGroups,
}));
vi.mock('../../queries/org-settings', () => ({
  useOrgSettings: queries.useOrgSettings,
}));
vi.mock('../../queries/announcements', () => ({
  useUnreadAnnouncementsCount: queries.useUnreadAnnouncementsCount,
}));
vi.mock('../../queries/notifications', () => ({
  useUnreadNotificationCount: queries.useUnreadNotificationCount,
  useReadOpenedNotification: queries.useReadOpenedNotification,
}));

vi.mock('../../lib/capabilities', () => ({
  useCapabilities: queries.useCapabilities,
}));
vi.mock('../../queries/live-changes', () => ({
  useLiveChanges: vi.fn(),
}));
vi.mock('../../queries/notifications-realtime', () => ({
  useNotificationRealtime: vi.fn(),
}));
vi.mock('../../queries/push-subscription', () => ({
  usePushSelfRepair: vi.fn(),
}));

import AppShell from './AppShell';
import type { Capabilities } from '../../lib/capabilities';
import {
  NAV_ITEMS,
  NOTIFICATIONS_PATH,
  PROFILE_PATH,
  navFor,
} from './navItems';

const ordinaryClaims = {
  member_role: 'voluntar',
  member_level: 1,
  group_ids: [],
};

/* The server capability row: all false unless a test says otherwise. */
function capabilities(granted: Partial<Capabilities> = {}): Capabilities {
  return {
    managesAnyGroup: false,
    manageTasks: false,
    seeDirectory: false,
    seeLeadership: false,
    manageRoles: false,
    provisionMembers: false,
    createTopLevelGroups: false,
    administer: false,
    manageDeals: false,
    manageDealsTeam: false,
    pickDealsCoordinator: false,
    ...granted,
  };
}

function renderShell(path = '/calendar') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<h1>Conținut</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    auth.signOut.mockResolvedValue(undefined);
    auth.useAuth.mockReturnValue({
      claims: ordinaryClaims,
      session: { user: { email: 'mara@osubb.ro' } },
      signOut: auth.signOut,
    });
    queries.useMyProfile.mockReturnValue({
      data: { full_name: 'Mara Pop', avatar_color: '#284C93' },
    });
    queries.useRoles.mockReturnValue({
      data: new Map([
        ['voluntar', { name: 'Voluntar', level: 1 }],
        ['bc', { name: 'BC', level: 6 }],
      ]),
    });
    queries.useMyGroups.mockReturnValue({ membershipRows: [] });
    queries.useOrgSettings.mockReturnValue({
      data: new Map([['board_group_id', '99']]),
    });
    queries.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 0 });
    queries.useCapabilities.mockReturnValue({ data: capabilities() });
    queries.usePendingDecisions.mockReturnValue({ data: [] });
  });

  it('reads a Notification opened from a push or an email, on every page (#1012)', () => {
    renderShell();

    expect(queries.useReadOpenedNotification).toHaveBeenCalled();
  });

  it('keeps ordinary navigation gated and marks the current route in both menus', () => {
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(within(primary).getAllByRole('link')).toHaveLength(7);
    expect(
      within(primary).getByRole('link', { name: 'Grupuri' }),
    ).toHaveAttribute('href', '/grupuri');
    expect(
      within(primary).getByRole('link', { name: 'Notificări' }),
    ).toHaveAttribute('href', '/notificari');
    expect(
      within(primary).queryByRole('link', { name: 'Voluntari' }),
    ).toBeNull();
    expect(
      within(primary).queryByRole('link', { name: 'Administrare' }),
    ).toBeNull();

    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(within(quick).getAllByRole('link')).toHaveLength(5);
    expect(
      within(primary).getByRole('link', { name: 'Calendar' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(quick).getByRole('link', { name: 'Calendar' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('renders the signed-in avatar colour only when it is #rrggbb (security audit F1)', () => {
    queries.useMyProfile.mockReturnValue({
      data: {
        full_name: 'Mara Pop',
        avatar_color: 'url(https://attacker.example/p.gif)',
      },
    });
    const { container } = renderShell();
    const avatars = [...container.querySelectorAll<HTMLElement>('[style]')];
    expect(avatars.length).toBeGreaterThan(0);
    for (const element of avatars)
      expect(element.getAttribute('style')).not.toContain('url(');
    expect(
      avatars.some(
        (element) => element.style.backgroundColor === 'var(--brand-red)',
      ),
    ).toBe(true);
  });

  it('offers Campaigns only to members who manage work in some Group', () => {
    queries.useCapabilities.mockReturnValue({ isPending: true });
    const view = renderShell();
    const primary = () =>
      screen.getByRole('navigation', { name: 'Navigare principală' });
    expect(
      within(primary()).queryByRole('link', { name: 'Campanii' }),
    ).toBeNull();

    queries.useCapabilities.mockReturnValue({
      data: capabilities({ manageTasks: true }),
    });
    view.rerender(
      <MemoryRouter initialEntries={['/calendar']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<h1>Conținut</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      within(primary()).getByRole('link', { name: 'Campanii' }),
    ).toHaveAttribute('href', '/administrare/campanii');
  });

  it('badges the notification entry with the unread count, in words too', () => {
    queries.useUnreadNotificationCount.mockReturnValue({ data: 3 });

    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    const entry = within(primary).getByRole('link', { name: /Notificări/ });
    expect(entry).toHaveTextContent('3');
    expect(
      within(entry).getByText('3 notificări necitite'),
    ).toBeInTheDocument();
  });

  it('badges Anunțuri with the unread-announcements count on the sidebar and the mobile tab', () => {
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 2 });

    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    const entry = within(primary).getByRole('link', { name: /Anunțuri/ });
    expect(entry).toHaveTextContent('2');
    expect(within(entry).getByText('2 anunțuri necitite')).toBeInTheDocument();

    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    const tab = within(quick).getByRole('link', {
      name: 'Anunțuri, 2 anunțuri necitite',
    });
    expect(tab).toHaveAttribute('href', '/anunturi');
    expect(tab).toHaveTextContent('2');
  });

  it('says a single unread Announcement in the singular', () => {
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 1 });

    renderShell();

    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(
      within(quick).getByRole('link', { name: 'Anunțuri, 1 anunț necitit' }),
    ).toBeInTheDocument();
  });

  it('drops the Anunțuri badge from both surfaces once the count reaches 0', () => {
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Anunțuri' }),
    ).toHaveTextContent(/^Anunțuri$/);
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(
      within(quick).getByRole('link', { name: 'Anunțuri' }),
    ).toHaveTextContent(/^Anunțuri$/);
  });

  it('leaves the notification entry unbadged once everything is read', () => {
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Notificări' }),
    ).toHaveTextContent(/^Notificări$/);
  });

  it('shows the mobile header bell with the unread count, hidden at desktop width', () => {
    queries.useUnreadNotificationCount.mockReturnValue({ data: 3 });

    const { container } = renderShell();
    const header = within(container.querySelector('header') as HTMLElement);

    const bell = header.getByRole('link', {
      name: 'Notificări, 3 notificări necitite',
    });
    expect(bell).toHaveAttribute('href', '/notificari');
    expect(bell).toHaveClass('lg:hidden');
    expect(bell).toHaveTextContent('3');
  });

  it('leaves the mobile header bell unbadged once everything is read', () => {
    const { container } = renderShell();
    const header = within(container.querySelector('header') as HTMLElement);

    const bell = header.getByRole('link', { name: 'Notificări' });
    expect(bell).toHaveAttribute('href', '/notificari');
    expect(bell).not.toHaveTextContent(/\d/);
  });

  it('renders the mobile header bell as a link with no Base UI nativeButton error (F-26)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = renderShell();
      const header = within(container.querySelector('header') as HTMLElement);
      expect(header.getByRole('link', { name: /^Notificări/ }).tagName).toBe(
        'A',
      );
      expect(error.mock.calls.flat().map(String).join(' ')).not.toMatch(
        /nativeButton/,
      );
    } finally {
      error.mockRestore();
    }
  });

  it('keeps the mobile header bell in its active state on the notifications screen itself', () => {
    const { container } = renderShell('/notificari');
    const header = within(container.querySelector('header') as HTMLElement);

    const bell = header.getByRole('link', { name: 'Notificări' });
    expect(bell).toHaveAttribute('aria-current', 'page');
  });

  it('uses the complete official logo as decorative mobile branding', () => {
    const { container } = renderShell();

    const topbar = container.querySelector('header');
    const marks = [...(topbar?.querySelectorAll('img') ?? [])];

    expect(marks).toHaveLength(2);
    expect(marks.map((mark) => mark.getAttribute('src'))).toEqual([
      expect.stringContaining('osubb-logo-on-light'),
      expect.stringContaining('osubb-logo-on-dark'),
    ]);
    marks.forEach((mark) => expect(mark).toHaveAttribute('alt', ''));
  });

  it('owns vertical page scrolling in the shared content viewport', () => {
    renderShell();

    expect(screen.getByRole('main')).toHaveClass(
      'overflow-y-auto',
      'overflow-x-hidden',
      'overscroll-contain',
    );
    expect(screen.getByRole('main')).not.toHaveClass('overflow-hidden');
  });

  it('ends at a phone keyboard and steps the bar aside while it is open (#1013)', () => {
    const { container } = renderShell();

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('h-[calc(100dvh-var(--keyboard-inset))]');
    expect(root).not.toHaveClass('h-dvh');
    expect(
      screen.getByRole('navigation', { name: 'Navigare rapidă' }),
    ).toHaveClass('keyboard:hidden');
    // The revealed field keeps a small gap above the keyboard.
    expect(screen.getByRole('main')).toHaveClass('keyboard:scroll-pb-3');
  });

  it('shows directory and Administrare destinations from the server capability row', () => {
    auth.useAuth.mockReturnValue({
      claims: { ...ordinaryClaims, member_role: 'bc', member_level: 6 },
      session: { user: { email: 'mara@osubb.ro' } },
      signOut: auth.signOut,
    });
    queries.useCapabilities.mockReturnValue({
      data: capabilities({
        managesAnyGroup: true,
        manageTasks: true,
        seeDirectory: true,
        seeLeadership: true,
        manageRoles: true,
        provisionMembers: true,
        createTopLevelGroups: true,
        administer: true,
        manageDeals: false,
        manageDealsTeam: false,
        pickDealsCoordinator: false,
      }),
    });
    renderShell('/administrare');

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Voluntari' }),
    ).toBeVisible();
    expect(
      within(primary).getByRole('link', { name: 'Administrare' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(primary).getByRole('link', { name: 'Campanii' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('lists Voluntari directly under Clasament in the sidebar; a phone has no menu (#910)', () => {
    queries.useCapabilities.mockReturnValue({
      data: capabilities({
        managesAnyGroup: true,
        manageTasks: true,
        seeDirectory: true,
        seeLeadership: true,
        manageRoles: true,
        provisionMembers: true,
        createTopLevelGroups: true,
        administer: true,
        manageDeals: false,
        manageDealsTeam: false,
        pickDealsCoordinator: false,
      }),
    });
    renderShell();

    const order = [
      'Acasă',
      'Taskuri',
      'Clasament',
      'Voluntari',
      'Grupuri',
      'Campanii',
      'Calendar',
      'Anunțuri',
      'Notificări',
      'Profil',
      'Administrare',
    ];
    const labels = (nav: HTMLElement) =>
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent?.replace(/\d+$/, '').trim());

    expect(
      labels(screen.getByRole('navigation', { name: 'Navigare principală' })),
    ).toEqual(order);

    // A phone has no second list of them: no menu button, no drawer.
    expect(
      screen.queryByRole('button', { name: 'Deschide meniul' }),
    ).toBeNull();
    expect(
      screen.queryByRole('navigation', { name: 'Meniu principal' }),
    ).toBeNull();
  });

  it.each([
    ['/administrare/membri', 'Administrare'],
    [
      '/administrare/membri/7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
      'Administrare',
    ],
    ['/administrare/grupuri', 'Administrare'],
    ['/administrare/grupuri/2', 'Administrare'],
    ['/administrare/evaluari', 'Administrare'],
    ['/administrare/setari', 'Administrare'],
    ['/administrare/campanii', 'Campanii'],
    ['/administrare/grupuri/2/campanii', 'Campanii'],
  ])(
    'on %s marks only %s, never both Administrare and Campanii (#825)',
    (path, active) => {
      queries.useCapabilities.mockReturnValue({
        data: capabilities({
          managesAnyGroup: true,
          manageTasks: true,
          manageRoles: true,
          provisionMembers: true,
          createTopLevelGroups: true,
          administer: true,
          manageDeals: false,
          manageDealsTeam: false,
          pickDealsCoordinator: false,
        }),
      });
      renderShell(path);
      const primary = screen.getByRole('navigation', {
        name: 'Navigare principală',
      });
      const other = active === 'Campanii' ? 'Administrare' : 'Campanii';
      expect(
        within(primary).getByRole('link', { name: active }),
      ).toHaveAttribute('aria-current', 'page');
      expect(
        within(primary).getByRole('link', { name: other }),
      ).not.toHaveAttribute('aria-current');
    },
  );

  it('offers Administrare to a level-1 Group Manager and not to a BCE without a Group Role', () => {
    queries.useCapabilities.mockReturnValue({
      data: capabilities({
        managesAnyGroup: true,
        manageTasks: true,
        administer: true,
        manageDeals: false,
        manageDealsTeam: false,
        pickDealsCoordinator: false,
      }),
    });
    const view = renderShell('/administrare/campanii');
    const primary = () =>
      screen.getByRole('navigation', { name: 'Navigare principală' });
    expect(
      within(primary()).getByRole('link', { name: 'Administrare' }),
    ).not.toHaveAttribute('aria-current');
    expect(
      within(primary()).getByRole('link', { name: 'Campanii' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(primary()).queryByRole('link', { name: 'Voluntari' }),
    ).toBeNull();
    view.unmount();

    queries.useCapabilities.mockReturnValue({
      data: capabilities({ seeDirectory: true, seeLeadership: true }),
    });
    renderShell();
    expect(
      within(primary()).queryByRole('link', { name: 'Administrare' }),
    ).toBeNull();
    expect(
      within(primary()).getByRole('link', { name: 'Voluntari' }),
    ).toBeVisible();
  });

  it('has no Cereri item: the Requests are a view of Taskuri, current there too (#973)', () => {
    renderShell('/tracker?vedere=cereri');

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(within(primary).queryByRole('link', { name: 'Cereri' })).toBeNull();
    expect(
      within(primary).getByRole('link', { name: 'Taskuri' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(
        screen.getByRole('navigation', { name: 'Navigare rapidă' }),
      ).getByRole('link', { name: 'Taskuri' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('gives a phone no menu: the top bar is the logo, the bell and the avatar, for leadership too', () => {
    // Clasament is on neither bar; it is reached from Acasă, not a drawer.
    queries.useCapabilities.mockReturnValue({
      data: capabilities({ seeLeadership: true, administer: true }),
    });
    renderShell();

    const header = within(screen.getByRole('banner'));
    expect(header.queryAllByRole('button')).toEqual([]);
    expect(
      header.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual(['/notificari', '/profil']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.queryByRole('navigation', { name: 'Meniu principal' }),
    ).toBeNull();
  });

  it('leaves no page without a door on a phone: the bar, the top bar, or Acasă’s tiles', () => {
    const everything = Object.fromEntries(
      NAV_ITEMS.flatMap((item) =>
        item.capability ? [[item.capability, true]] : [],
      ),
    );
    const { visible, tabs, elsewhere } = navFor(capabilities(everything));
    expect(visible).toEqual(NAV_ITEMS);
    // Administrare took Grupuri's tab, so Grupuri is one of Acasă's tiles.
    expect(tabs.map((item) => item.label)).toEqual([
      'Taskuri',
      'Calendar',
      'Acasă',
      'Anunțuri',
      'Administrare',
    ]);
    expect(elsewhere.map((item) => item.label)).toEqual([
      'Clasament',
      'Voluntari',
      'Grupuri',
      'Campanii',
    ]);
    for (const item of visible)
      expect(
        tabs.includes(item) ||
          elsewhere.includes(item) ||
          item.path === NOTIFICATIONS_PATH ||
          item.path === PROFILE_PATH,
        item.label,
      ).toBe(true);

    // A volunteer's pages are all on the bar or in the top bar.
    expect(navFor(capabilities()).elsewhere).toEqual([]);
    // Before the capabilities arrive, nothing gated is offered.
    expect(navFor(undefined).elsewhere).toEqual([]);
  });

  it('names the Role in the sidebar footer, never its level (#844, B44)', () => {
    renderShell();
    expect(screen.getByTitle('Voluntar')).toHaveTextContent(/^Voluntar$/);
    expect(screen.queryByText(/nivel/)).toBeNull();
  });

  it('names a board member by their Board Title in the sidebar footer (#963)', () => {
    auth.useAuth.mockReturnValue({
      claims: { member_role: 'bc', member_level: 6, group_ids: [] },
      session: { user: { email: 'cristina@osubb.ro' } },
      signOut: auth.signOut,
    });
    queries.useMyGroups.mockReturnValue({
      membershipRows: [
        {
          group_id: 99,
          group_role: 'responsible',
          position_title: 'Președinte',
        },
      ],
    });
    renderShell();
    expect(screen.getByTitle('Președinte')).toHaveTextContent(/^Președinte$/);
    expect(screen.queryByTitle('BC')).toBeNull();
  });

  it('keeps the Role name for a board member without a title (#963)', () => {
    auth.useAuth.mockReturnValue({
      claims: { member_role: 'bc', member_level: 6, group_ids: [] },
      session: { user: { email: 'cristina@osubb.ro' } },
      signOut: auth.signOut,
    });
    renderShell();
    expect(screen.getByTitle('BC')).toHaveTextContent(/^BC$/);
  });

  it('marks Clasament, not Taskuri, on a member history (#844, D17)', () => {
    queries.useCapabilities.mockReturnValue({
      data: capabilities({ seeLeadership: true }),
    });
    renderShell('/tracker/membru/35400000-0000-0000-0000-000000000001');
    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Clasament' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(primary).getByRole('link', { name: 'Taskuri' }),
    ).not.toHaveAttribute('aria-current');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(
      within(quick).getByRole('link', { name: 'Taskuri' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('keeps Taskuri marked on the Tracker itself (#844)', () => {
    queries.useCapabilities.mockReturnValue({
      data: capabilities({ seeLeadership: true }),
    });
    renderShell('/tracker');
    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Taskuri' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(primary).getByRole('link', { name: 'Clasament' }),
    ).not.toHaveAttribute('aria-current');
  });

  it.each([
    [{ denied: true }, 'Nu ai acces la pagina cerută.'],
    [
      { leadershipDenied: true },
      'Clasamentul și istoricul membrilor sunt disponibile doar conducerii OSUBB.',
    ],
  ])(
    'says why a refused route landed here (%o, #844 D21)',
    (state, message) => {
      render(
        <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<h1>Conținut</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    },
  );

  it('shows no refusal line on an ordinary visit (#844)', () => {
    renderShell('/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no sign-out in the sidebar or the phone top bar (R41)', () => {
    renderShell();
    const signOut = /deconect/i;

    const sidebar = screen
      .getByRole('navigation', { name: 'Navigare principală' })
      .closest('aside') as HTMLElement;
    // The footer still says who is signed in, with no way out beside it.
    expect(within(sidebar).getByText('Mara Pop')).toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: signOut })).toBeNull();
    expect(within(sidebar).queryByText(signOut)).toBeNull();

    const header = within(screen.getByRole('banner'));
    expect(header.queryByRole('button', { name: signOut })).toBeNull();
    expect(header.queryByText(signOut)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe('phone navigation (#972)', () => {
  beforeEach(() => {
    auth.signOut.mockResolvedValue(undefined);
    auth.useAuth.mockReturnValue({
      claims: ordinaryClaims,
      session: { user: { email: 'mara@osubb.ro' } },
      signOut: auth.signOut,
    });
    queries.useMyProfile.mockReturnValue({
      data: { full_name: 'Mara Pop', avatar_color: '#284C93' },
    });
    queries.useRoles.mockReturnValue({
      data: new Map([
        ['voluntar', { name: 'Voluntar', level: 1 }],
        ['bc', { name: 'BC', level: 6 }],
      ]),
    });
    queries.useMyGroups.mockReturnValue({ membershipRows: [] });
    queries.useOrgSettings.mockReturnValue({
      data: new Map([['board_group_id', '99']]),
    });
    queries.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 0 });
    queries.useCapabilities.mockReturnValue({ data: capabilities() });
    queries.usePendingDecisions.mockReturnValue({ data: [] });
  });

  const captions = (nav: HTMLElement) =>
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.replace(/\d+$/, '').trim());

  it('orders the bar Taskuri, Calendar, Acasă in the centre, Anunțuri, Grupuri', () => {
    renderShell('/');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(captions(quick)).toEqual([
      'Taskuri',
      'Calendar',
      'Acasă',
      'Anunțuri',
      'Grupuri',
    ]);
    expect(within(quick).getByRole('link', { name: 'Acasă' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(quick).getByRole('link', { name: 'Grupuri' }),
    ).toHaveAttribute('href', '/grupuri');
    expect(within(quick).queryByRole('link', { name: 'Profil' })).toBeNull();
  });

  it('reaches Profil only from the avatar in the top bar on a phone', () => {
    renderShell('/profil');
    const header = within(screen.getByRole('banner'));
    const avatar = header.getByRole('link', { name: 'Profil' });
    expect(avatar).toHaveAttribute('href', '/profil');
    expect(avatar).toHaveAttribute('aria-current', 'page');
    expect(avatar).toHaveTextContent('MP');
    expect(avatar.className).toContain('lg:hidden');
    // The laptop sidebar keeps Profil and Notificări as entries.
    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Profil' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(primary).getByRole('link', { name: 'Notificări' }),
    ).toBeInTheDocument();
  });

  it('shows no hamburger, whatever pages the Member has', () => {
    const { unmount } = renderShell('/');
    expect(
      screen.queryByRole('button', { name: 'Deschide meniul' }),
    ).toBeNull();
    unmount();

    // Administrare takes Grupuri's place on the bar; Clasament and Grupuri
    // are Acasă's tiles.
    queries.useCapabilities.mockReturnValue({
      data: capabilities({ administer: true, seeLeadership: true }),
    });
    renderShell('/');
    expect(
      screen.queryByRole('button', { name: 'Deschide meniul' }),
    ).toBeNull();
    expect(
      captions(screen.getByRole('navigation', { name: 'Navigare rapidă' })),
    ).toEqual(['Taskuri', 'Calendar', 'Acasă', 'Anunțuri', 'Administrare']);
  });

  it('badges Taskuri with the Requests waiting for a decision, on the bar and the sidebar', () => {
    queries.usePendingDecisions.mockReturnValue({
      data: [{ id: 1 }, { id: 2 }],
    });
    renderShell('/calendar');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(
      within(quick).getByRole('link', { name: /^Taskuri, 2 cereri de decis$/ }),
    ).toHaveTextContent('2');
    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', {
        name: /^Taskuri\s*2 cereri de decis$/,
      }),
    ).toBeInTheDocument();
  });

  it('keeps every bar control 44 px, none raised: the current tab alone spells its name', () => {
    renderShell('/calendar');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    expect(quick.querySelector('[data-slot="home-tab"]')).toBeNull();
    const links = within(quick).getAllByRole('link');
    for (const link of links) expect(link.className).toMatch(/\bh-11\b/);
    for (const link of links) {
      const label = link.querySelector('[data-slot="tab-label"]');
      const current = link.getAttribute('aria-current') === 'page';
      // Every tab keeps its name; only the current one draws it.
      expect(label?.textContent).not.toBe('');
      expect(label?.classList.contains('sr-only')).toBe(!current);
      expect(link.className.includes('flex-1')).toBe(current);
    }
    expect(
      within(quick).getByRole('link', { name: 'Calendar', current: 'page' }),
    ).toBeVisible();
  });

  it('gives a plain member Grupuri as the fifth tab, and Administrare instead to whoever has it', () => {
    const { unmount } = renderShell('/grupuri');
    expect(
      captions(screen.getByRole('navigation', { name: 'Navigare rapidă' })),
    ).toEqual(['Taskuri', 'Calendar', 'Acasă', 'Anunțuri', 'Grupuri']);
    unmount();

    queries.useCapabilities.mockReturnValue({
      data: capabilities({ administer: true }),
    });
    renderShell('/administrare');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    // The full word while it fits; "Admin" is only for a bar too narrow.
    expect(
      within(quick).getByRole('link', {
        name: 'Administrare',
        current: 'page',
      }),
    ).toHaveAttribute('href', '/administrare');
    expect(within(quick).queryByRole('link', { name: 'Grupuri' })).toBeNull();
  });
});

describe('the top bar carries no page name (#981)', () => {
  beforeEach(() => {
    auth.signOut.mockResolvedValue(undefined);
    auth.useAuth.mockReturnValue({
      claims: ordinaryClaims,
      session: { user: { email: 'mara@osubb.ro' } },
      signOut: auth.signOut,
    });
    queries.useMyProfile.mockReturnValue({
      data: { full_name: 'Mara Pop', avatar_color: '#284C93' },
    });
    queries.useRoles.mockReturnValue({
      data: new Map([['voluntar', { name: 'Voluntar', level: 1 }]]),
    });
    queries.useMyGroups.mockReturnValue({ membershipRows: [] });
    queries.useOrgSettings.mockReturnValue({ data: new Map() });
    queries.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 0 });
    queries.useCapabilities.mockReturnValue({ data: capabilities() });
    queries.usePendingDecisions.mockReturnValue({ data: [] });
  });

  it('shows no page name in the bar, and hides the bar from laptop width', () => {
    const { container } = renderShell('/calendar');
    const header = screen.getByRole('banner');
    // The page's own header names the page; the bar does not repeat it.
    expect(header.textContent).not.toMatch(/Calendar/);
    expect(header.className).toContain('lg:hidden');
    // On a laptop the grid is sidebar | main, with no row for a top bar.
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("lg:[grid-template-areas:'sidebar_main']");
    expect(root.className).not.toContain('sidebar_topbar');
  });

  it('opens the top bar’s bell and avatar into the named pill on their own pages', () => {
    const profile = renderShell('/profil');
    const profileHeader = within(
      profile.container.querySelector('header') as HTMLElement,
    );
    const avatar = profileHeader.getByRole('link', { name: 'Profil' });
    expect(avatar).toHaveAttribute('aria-current', 'page');
    expect(avatar).toHaveTextContent('Profil');
    expect(
      profileHeader.getByRole('link', { name: 'Notificări' }),
    ).not.toHaveTextContent('Notificări');
    profile.unmount();

    const { container } = renderShell('/notificari');
    const header = within(container.querySelector('header') as HTMLElement);
    expect(header.getByRole('link', { name: 'Notificări' })).toHaveTextContent(
      'Notificări',
    );
    expect(header.getByRole('link', { name: 'Profil' })).not.toHaveTextContent(
      'Profil',
    );
  });

  it('keeps Acasă outlined and named on a page reached from its tiles, and nothing current', () => {
    queries.useCapabilities.mockReturnValue({
      data: capabilities({ seeLeadership: true }),
    });
    renderShell('/clasament');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    const home = within(quick).getByRole('link', { name: 'Acasă' });
    expect(home).not.toHaveAttribute('aria-current');
    expect(home.className).toContain('ring-inset');
    expect(
      home.querySelector('[data-slot="tab-label"]')?.className,
    ).not.toContain('sr-only');
    expect(within(quick).queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('outlines no tab on Profil, which is the top bar’s', () => {
    renderShell('/profil');
    const quick = screen.getByRole('navigation', { name: 'Navigare rapidă' });
    for (const link of within(quick).getAllByRole('link'))
      expect(link.className).not.toContain('ring-inset');
  });
});
