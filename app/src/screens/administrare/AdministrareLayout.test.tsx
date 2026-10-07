import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Capabilities } from '../../lib/capabilities';

const api = vi.hoisted(() => ({
  capabilities: vi.fn(),
  applications: vi.fn(),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
}));
// Whether a managed Group takes Applications is its own tested rule
// (`applications-tab.test.ts`); here it is an answer the layout reads.
vi.mock('./applications-tab', () => ({
  useApplicationsTabShown: api.applications,
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
  administerBc: false,
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
  administerBc: false,
  manageDeals: false,
  manageDealsTeam: false,
  pickDealsCoordinator: false,
};
/* R44: the Moderator alone holds administerBc. */
const MODERATOR: Capabilities = { ...BC, administerBc: true };
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
  administerBc: false,
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

const tabBar = () =>
  screen.getByRole('navigation', { name: 'Secțiunile administrării' });
const tabNames = () =>
  within(tabBar())
    .getAllByRole('link')
    .map((link) => link.textContent);

beforeEach(() => {
  api.capabilities.mockReset();
  api.applications.mockReset();
  api.applications.mockReturnValue(true);
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
  expect(
    screen.getByText(
      'Grupurile OSUBB, membrii, rolurile și setările organizației.',
    ),
  ).toBeVisible();
  expect(
    within(tabBar()).getByRole('link', { name: 'Evaluări de rol' }),
  ).toHaveAttribute('href', '/administrare/evaluari');
  expect((await axe.run(container)).violations).toEqual([]);
});

it('adds Administrare BC for the Moderator alone (R44)', () => {
  show('/administrare/bc', MODERATOR);
  expect(tabNames().slice(-2)).toEqual(['OSUBB Deals', 'Administrare BC']);
  expect(
    within(tabBar()).getByRole('link', { name: 'Administrare BC' }),
  ).toHaveAttribute('aria-current', 'page');
});

it('shows a Responsabil OSUBB Deals with nothing else that one page, no tab strip (R44)', () => {
  const view = show('/administrare', DEALS_RESPONSABIL);
  expect(screen.getByTestId('where')).toHaveTextContent('/administrare/deals');
  view.unmount();
  show('/administrare/deals', DEALS_RESPONSABIL);
  expect(
    screen.queryByRole('navigation', { name: 'Secțiunile administrării' }),
  ).toBeNull();
  expect(
    screen.getByText('Echipa OSUBB Deals și deal-urile ei.'),
  ).toBeVisible();
});

it('shows a Group Manager or Responsible Grupuri and Cereri de aderare only', () => {
  show('/administrare/grupuri', MANAGER);
  expect(tabNames()).toEqual(['Grupuri', 'Cereri de aderare']);
  // A Responsible does not coordinate (relevance B56).
  expect(screen.getByText('Grupurile în care ai o funcție.')).toBeVisible();
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

it('opens the header action slot only on the tab that has an action', () => {
  const view = show('/administrare/grupuri', BC);
  expect(
    document.querySelector('[data-slot="administrare-actions"]'),
  ).not.toBeNull();
  view.unmount();

  show('/administrare/grupuri', MANAGER);
  expect(
    document.querySelector('[data-slot="administrare-actions"]'),
  ).toBeNull();
});
