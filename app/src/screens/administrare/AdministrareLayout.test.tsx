import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Capabilities } from '../../lib/capabilities';

const api = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: api.capabilities,
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
};
const MANAGER: Capabilities = {
  ...NONE,
  managesAnyGroup: true,
  manageTasks: true,
  administer: true,
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

beforeEach(() => api.capabilities.mockReset());

it('shows BC and the Moderator all seven tabs, in the order Alex listed', async () => {
  const { container } = show('/administrare/grupuri', BC);
  expect(tabNames()).toEqual([
    'Membri',
    'Grupuri',
    'Roluri',
    'Cereri',
    'Evaluări de rol',
    'Confidențialitate',
    'Setări',
  ]);
  expect(
    screen.getByRole('heading', { level: 1, name: 'Administrare' }),
  ).toBeVisible();
  expect(
    document.querySelector('[data-slot="page-eyebrow"]'),
  ).toHaveTextContent(/^Administrare$/);
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

it('shows a Group Manager or Responsible Grupuri and Cereri only', () => {
  show('/administrare/grupuri', MANAGER);
  expect(tabNames()).toEqual(['Grupuri', 'Cereri']);
  expect(screen.getByText('Grupurile pe care le coordonezi.')).toBeVisible();
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
