import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { Plus } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FabAction } from '../../components/layout';
import type { Capabilities } from '../../lib/capabilities';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  applications: vi.fn(),
  pending: vi.fn(),
}));
// The real client needs env that CI does not have; nothing here calls it.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
// Whether a managed Group takes Applications is its own tested rule
// (`applications-tab.test.ts`); here it is an answer the layout reads.
vi.mock('./applications-tab', async (original) => ({
  applicationCount: (await original<typeof import('./applications-tab')>())
    .applicationCount,
  useApplicationsTabShown: api.applications,
  usePendingApplicationCount: api.pending,
}));
import AdministrareLayout from './AdministrareLayout';

const NONE: Capabilities = {
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
};
const BC: Capabilities = {
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
};
/* A Responsabil OSUBB Deals with no Group Role and no rank. */
const DEALS_RESPONSABIL: Capabilities = {
  ...NONE,
  administer: true,
  manageDeals: true,
};
const MANAGER: Capabilities = {
  ...NONE,
  managesAnyGroup: true,
  manageTasks: true,
  administer: true,
  manageDeals: false,
  manageDealsTeam: false,
  pickDealsCoordinator: false,
};

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function show(path: string, capabilities: Capabilities | undefined) {
  api.capabilities.mockReturnValue({ data: capabilities });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/administrare" element={<AdministrareLayout />}>
          {[
            'membri',
            'grupuri',
            'roluri',
            'cereri',
            'evaluari',
            'confidentialitate',
            'setari',
            'deals',
            'bc',
          ].map((tab) => (
            <Route key={tab} path={tab} element={<Where />} />
          ))}
        </Route>
        <Route path="/" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const NAV = 'Secțiunile administrării';
const tabBar = () => screen.getByRole('navigation', { name: NAV });
const tabNames = () =>
  within(tabBar())
    .getAllByRole('link')
    .map((link) => link.textContent);

beforeEach(() => {
  api.capabilities.mockReset();
  api.applications.mockReset();
  api.applications.mockReturnValue(true);
  api.pending.mockReset();
  api.pending.mockReturnValue(0);
});

it('shows BC the seven tabs in the order Alex listed, then OSUBB Deals (R44)', async () => {
  const { container } = show('/administrare/grupuri', BC);
  expect(tabNames()).toEqual([
    'Membri',
    'Grupuri',
    'Roluri',
    'Cereri de aderare',
    'Evaluări de rol',
    'Confidențialitate',
    'Setări',
    'OSUBB Deals',
  ]);
  expect(
    screen.getByRole('heading', { level: 1, name: 'Administrare' }),
  ).toBeVisible();
  // Administrare is the area itself: no eyebrow repeats the title (F-24).
  expect(document.querySelector('[data-slot="page-eyebrow"]')).toBeNull();
  // The title says what the page is: no tagline under it.
  expect(document.querySelector('[data-slot="page-description"]')).toBeNull();
  expect(
    within(tabBar()).getByRole('link', { name: 'Evaluări de rol' }),
  ).toHaveAttribute('href', '/administrare/evaluari');
  expect((await axe.run(container)).violations).toEqual([]);
});

it('shows a Responsabil OSUBB Deals with nothing else that one page, no tab strip (R44)', () => {
  const view = show('/administrare', DEALS_RESPONSABIL);
  expect(screen.getByTestId('where')).toHaveTextContent('/administrare/deals');
  view.unmount();
  show('/administrare/deals', DEALS_RESPONSABIL);
  expect(
    screen.queryByRole('navigation', { name: 'Secțiunile administrării' }),
  ).toBeNull();
});

it('shows a Group Manager or Responsible Grupuri and Cereri de aderare only', () => {
  show('/administrare/grupuri', MANAGER);
  expect(tabNames()).toEqual(['Grupuri', 'Cereri de aderare']);
});

it('hides Cereri de aderare while none of the viewer’s Groups takes Applications or has one pending (B55)', () => {
  api.applications.mockReturnValue(false);
  const view = show('/administrare/grupuri', MANAGER);
  // One section needs no tab strip (F-24): the title and the page carry it.
  expect(
    screen.queryByRole('navigation', { name: 'Secțiunile administrării' }),
  ).toBeNull();
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/grupuri',
  );
  view.unmount();

  // Not known yet: not shown, so it never appears and then vanishes.
  api.applications.mockReturnValue(undefined);
  const loading = show('/administrare/grupuri', MANAGER);
  expect(
    screen.queryByRole('navigation', { name: 'Secțiunile administrării' }),
  ).toBeNull();
  loading.unmount();

  // Opened by a link, the page keeps its tab.
  api.applications.mockReturnValue(false);
  show('/administrare/cereri', MANAGER);
  expect(tabNames()).toEqual(['Grupuri', 'Cereri de aderare']);
  expect(
    within(tabBar()).getByRole('link', { name: 'Cereri de aderare' }),
  ).toHaveAttribute('aria-current', 'page');
});

it('marks the open tab aria-current and moves with a click', async () => {
  const user = userEvent.setup();
  show('/administrare/roluri?membru=abc', BC);
  const current = within(tabBar()).getByRole('link', { name: 'Roluri' });
  expect(current).toHaveAttribute('aria-current', 'page');
  expect(
    within(tabBar()).getByRole('link', { name: 'Membri' }),
  ).not.toHaveAttribute('aria-current');
  // `?membru=` from a Retention Signal survives into the Roluri tab.
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/roluri?membru=abc',
  );

  await user.click(within(tabBar()).getByRole('link', { name: 'Setări' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/administrare/setari');
  expect(
    within(tabBar()).getByRole('link', { name: 'Setări' }),
  ).toHaveAttribute('aria-current', 'page');
});

// From 1024 px (and in a test DOM, which has no `matchMedia`).
it.each([
  ['BC', BC, '/administrare/membri'],
  ['a Group Manager', MANAGER, '/administrare/grupuri'],
  ['someone with no tab', NONE, '/'],
])(
  'lands /administrare on the first tab %s may open',
  (_who, capabilities, landing) => {
    show('/administrare', capabilities);
    expect(screen.getByTestId('where')).toHaveTextContent(landing);
  },
);

it('turns a tab’s create action into the page’s plus button', () => {
  api.capabilities.mockReturnValue({ data: BC });
  render(
    <MemoryRouter initialEntries={['/administrare/grupuri']}>
      <Routes>
        <Route path="/administrare" element={<AdministrareLayout />}>
          <Route
            path="grupuri"
            element={
              <FabAction label="Creează Grup" icon={Plus} onSelect={() => {}} />
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Creează Grup' })).toHaveAttribute(
    'data-slot',
    'fab',
  );
});

/* Under 1024 px three tabs of nine fit: the sections are a menu instead. */
describe('on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows /administrare as a menu of the sections the viewer may open', async () => {
    api.pending.mockReturnValue(3);
    const user = userEvent.setup();
    const { container } = show('/administrare', BC);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 64rem)');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Administrare' }),
    ).toBeVisible();
    const menu = tabBar();
    expect(menu).toHaveAttribute('data-slot', 'administrare-menu');
    const tiles = within(menu).getAllByRole('link');
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/administrare/membri',
      '/administrare/grupuri',
      '/administrare/roluri',
      '/administrare/cereri',
      '/administrare/evaluari',
      '/administrare/confidentialitate',
      '/administrare/setari',
      '/administrare/deals',
    ]);
    // Each tile: an icon, the section's name, and a count where one is read.
    for (const tile of tiles) expect(tile.querySelector('svg')).not.toBeNull();
    expect(within(menu).getByRole('link', { name: 'Membri' })).toBeVisible();
    const applications = within(menu).getByRole('link', {
      name: 'Cereri de aderare, 3 cereri în așteptare',
    });
    expect(
      applications.querySelector('[data-slot="section-count"]'),
    ).toHaveTextContent('3');
    expect(menu.querySelectorAll('[data-slot="section-count"]')).toHaveLength(
      1,
    );
    expect((await axe.run(container)).violations).toEqual([]);

    await user.click(within(menu).getByRole('link', { name: 'Setări' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/administrare/setari',
    );
  });

  it('heads a section with its own name and a way back, and no tab strip', () => {
    show('/administrare/roluri?membru=abc', BC);
    // A link to a section opens it at every width.
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/administrare/roluri?membru=abc',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Roluri' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Administrare' })).toHaveAttribute(
      'href',
      '/administrare',
    );
    expect(screen.queryByRole('navigation', { name: NAV })).toBeNull();
  });

  it('lands a viewer with one section straight in it, with no way back to a menu', () => {
    const view = show('/administrare', DEALS_RESPONSABIL);
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/administrare/deals',
    );
    expect(screen.queryByRole('link', { name: 'Administrare' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Administrare' }),
    ).toBeVisible();
    view.unmount();

    show('/administrare', NONE);
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('waits for Cereri de aderare before choosing between the menu and the one page', () => {
    // Not known yet: neither the menu nor a redirect past it.
    api.applications.mockReturnValue(undefined);
    const waiting = show('/administrare', MANAGER);
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.queryByRole('navigation', { name: NAV })).toBeNull();
    waiting.unmount();

    api.applications.mockReturnValue(false);
    const one = show('/administrare', MANAGER);
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/administrare/grupuri',
    );
    one.unmount();

    api.applications.mockReturnValue(true);
    show('/administrare', MANAGER);
    expect(
      within(tabBar())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Grupuri', 'Cereri de aderare']);
  });
});
