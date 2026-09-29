import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ useAuth: vi.fn(), signOut: vi.fn() }));
const queries = vi.hoisted(() => ({
  useMyProfile: vi.fn(),
  useRoles: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
  useUnreadAnnouncementsCount: vi.fn(),
  useCapabilities: vi.fn(),
  usePendingDecisions: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
// The real `submitsWorkRequests` rule is read from capabilities.ts, whose
// module also builds the shared client.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/profile', () => ({
  useMyProfile: queries.useMyProfile,
}));
vi.mock('../../queries/reference', () => ({ useRoles: queries.useRoles }));
vi.mock('../../queries/announcements', () => ({
  useUnreadAnnouncementsCount: queries.useUnreadAnnouncementsCount,
}));
vi.mock('../../queries/notifications', () => ({
  useUnreadNotificationCount: queries.useUnreadNotificationCount,
}));

vi.mock('../../lib/capabilities', async (original) => ({
  submitsWorkRequests: (
    await original<typeof import('../../lib/capabilities')>()
  ).submitsWorkRequests,
  useCapabilities: queries.useCapabilities,
}));
vi.mock('../../queries/request-decisions', () => ({
  usePendingDecisions: queries.usePendingDecisions,
}));
vi.mock('../../queries/notifications-realtime', () => ({
  useNotificationRealtime: vi.fn(),
}));
vi.mock('../../queries/push-subscription', () => ({
  usePushSelfRepair: vi.fn(),
}));

import AppShell from './AppShell';
import type { Capabilities } from '../../lib/capabilities';

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
      data: new Map([['voluntar', { name: 'Voluntar' }]]),
    });
    queries.useUnreadNotificationCount.mockReturnValue({ data: 0 });
    queries.useUnreadAnnouncementsCount.mockReturnValue({ data: 0 });
    queries.useCapabilities.mockReturnValue({ data: capabilities() });
    queries.usePendingDecisions.mockReturnValue({ data: [] });
  });

  it('keeps ordinary navigation gated and marks the current route in both menus', () => {
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(within(primary).getAllByRole('link')).toHaveLength(8);
    expect(
      within(primary).getByRole('link', { name: 'Grupuri' }),
    ).toHaveAttribute('href', '/grupuri');
    expect(
      within(primary).getByRole('link', { name: 'Cereri' }),
    ).toHaveAttribute('href', '/cereri');
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

  it('lists Voluntari directly under Clasament in the sidebar and the phone menu (#910)', async () => {
    const user = userEvent.setup();
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
      }),
    });
    renderShell();

    const order = [
      'Acasă',
      'Taskuri',
      'Clasament',
      'Voluntari',
      'Grupuri',
      'Cereri',
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

    await user.click(screen.getByRole('button', { name: 'Deschide meniul' }));
    expect(
      labels(
        within(screen.getByRole('dialog', { name: 'Meniu' })).getByRole(
          'navigation',
          { name: 'Meniu principal' },
        ),
      ),
    ).toEqual(order);
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

  describe('Cereri at level 5, where nobody files a Request (#855, B30)', () => {
    beforeEach(() => {
      auth.useAuth.mockReturnValue({
        claims: { ...ordinaryClaims, member_role: 'bce', member_level: 5 },
        session: { user: { email: 'mara@osubb.ro' } },
        signOut: auth.signOut,
      });
    });
    const cereri = () =>
      within(
        screen.getByRole('navigation', { name: 'Navigare principală' }),
      ).queryByRole('link', { name: 'Cereri' });

    it('hides the item with nothing to decide, and while the queue loads', () => {
      const view = renderShell();
      expect(cereri()).toBeNull();
      queries.usePendingDecisions.mockReturnValue({ isPending: true });
      view.rerender(
        <MemoryRouter initialEntries={['/calendar']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<h1>Conținut</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      expect(cereri()).toBeNull();
    });

    it('keeps the item when the queue cannot be read, so its retry is reachable', () => {
      queries.usePendingDecisions.mockReturnValue({ isError: true });
      renderShell();
      expect(cereri()).toHaveAttribute('href', '/cereri');
    });

    it('shows the item with one Request to decide', () => {
      queries.usePendingDecisions.mockReturnValue({ data: [{ id: 7 }] });
      renderShell();
      expect(cereri()).toHaveAttribute('href', '/cereri');
    });

    it('keeps the item while the viewer is on the page', () => {
      renderShell('/cereri');
      expect(cereri()).toHaveAttribute('aria-current', 'page');
    });
  });

  it('shows Cereri below level 5 with nothing to decide', () => {
    renderShell();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Navigare principală' }),
      ).getByRole('link', { name: 'Cereri' }),
    ).toHaveAttribute('href', '/cereri');
  });

  it('opens a keyboard-safe mobile menu and returns focus when Escape closes it', async () => {
    const user = userEvent.setup();
    renderShell();

    const menuButton = screen.getByRole('button', { name: 'Deschide meniul' });
    await user.click(menuButton);

    const dialog = screen.getByRole('dialog', { name: 'Meniu' });
    const drawer = within(dialog).getByRole('navigation', {
      name: 'Meniu principal',
    });
    await waitFor(() =>
      expect(within(drawer).getByRole('link', { name: 'Acasă' })).toHaveFocus(),
    );
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('navigation', { name: 'Meniu principal' }),
    ).toBeNull();
    expect(menuButton).toHaveFocus();
  });

  it('releases the modal drawer when the viewport crosses to desktop', async () => {
    const user = userEvent.setup();
    let notifyBreakpoint: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (
          _type: string,
          listener: (event: { matches: boolean }) => void,
        ) => {
          notifyBreakpoint = listener;
        },
        removeEventListener: vi.fn(),
      })),
    );
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Deschide meniul' }));
    expect(screen.getByRole('dialog', { name: 'Meniu' })).toBeVisible();

    notifyBreakpoint?.({ matches: true });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Meniu' })).toBeNull(),
    );
  });

  it('names the Role in the sidebar footer, never its level (#844, B44)', () => {
    renderShell();
    expect(screen.getByTitle('Voluntar')).toHaveTextContent(/^Voluntar$/);
    expect(screen.queryByText(/nivel/)).toBeNull();
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

  it('keeps sign-out failures in the shell and unlocks retry', async () => {
    const user = userEvent.setup();
    auth.signOut.mockRejectedValueOnce(new Error('private provider error'));
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Deconectare' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu te-am putut deconecta. Încearcă din nou.',
    );
    expect(screen.getByRole('button', { name: 'Deconectare' })).toBeEnabled();
    expect(screen.queryByText(/private provider error/i)).toBeNull();
  });
});
