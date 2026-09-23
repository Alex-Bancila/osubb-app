import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth = vi.hoisted(() => ({ useAuth: vi.fn(), signOut: vi.fn() }));
const queries = vi.hoisted(() => ({
  useMyProfile: vi.fn(),
  useRoles: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
  useCapabilities: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
vi.mock('../../queries/profile', () => ({
  useMyProfile: queries.useMyProfile,
}));
vi.mock('../../queries/reference', () => ({ useRoles: queries.useRoles }));
vi.mock('../../queries/notifications', () => ({
  useUnreadNotificationCount: queries.useUnreadNotificationCount,
}));

vi.mock('../../lib/capabilities', () => ({
  useCapabilities: queries.useCapabilities,
}));
vi.mock('../../queries/notifications-realtime', () => ({
  useNotificationRealtime: vi.fn(),
}));

import AppShell from './AppShell';
import type { Capabilities } from '../../lib/capabilities';

const ordinaryClaims = {
  member_role: 'voluntar',
  member_level: 1,
  dept_ids: [],
  team_ids: [],
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
    queries.useCapabilities.mockReturnValue({ data: capabilities() });
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

  it('leaves the notification entry unbadged once everything is read', () => {
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Notificări' }),
    ).toHaveTextContent(/^Notificări$/);
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

  it('keeps the Cereri nav item at level 5, where the submission form is hidden (#631)', () => {
    auth.useAuth.mockReturnValue({
      claims: { ...ordinaryClaims, member_role: 'bce', member_level: 5 },
      session: { user: { email: 'mara@osubb.ro' } },
      signOut: auth.signOut,
    });
    renderShell();

    const primary = screen.getByRole('navigation', {
      name: 'Navigare principală',
    });
    expect(
      within(primary).getByRole('link', { name: 'Cereri' }),
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
