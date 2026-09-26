import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import * as axe from 'axe-core';
import type { AdminGroup } from '../../queries/groups-admin';
import type { GroupApplication } from '../../queries/group-applications';
const api = vi.hoisted(() => ({
  groups: vi.fn(),
  mine: vi.fn(),
  applications: vi.fn(),
  mutate: vi.fn(),
  roster: vi.fn(),
  events: vi.fn(),
  level: 1,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    claims: { member_level: api.level },
    session: { user: { id: 'me' } },
  }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: () => ({ data: { createTopLevelGroups: false } }),
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useAdminGroups: api.groups,
  useMyGroupRoles: api.mine,
}));
vi.mock('../../queries/group-applications', () => ({
  useGroupApplications: api.applications,
  useGroupCoordination: api.roster,
  useApplicationCommand: () => ({ mutateAsync: api.mutate, isPending: false }),
  useGroupUpcomingEvents: api.events,
}));
import GroupsScreen from './GroupsScreen';
import MemberGroupScreen from './MemberGroupScreen';
import { GroupApplicationsTab } from '../administrare/GroupApplicationsTab';
function group(
  id: number,
  name: string,
  extra: Partial<AdminGroup> = {},
): AdminGroup {
  return {
    id,
    name,
    parent_id: null,
    path: [id],
    category: 'team',
    color: '#284C93',
    short: null,
    status: 'active',
    is_organization: false,
    min_level: 0,
    application_level: 1,
    accepts_applications: true,
    automatic_membership: false,
    shared_work_visibility: true,
    manager_title: 'Coordonator',
    competes_in_cup: false,
    counts_toward_parent_cup: false,
    is_private: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 1,
    ...extra,
  };
}
const application: GroupApplication = {
  id: 7,
  group_id: 2,
  member_id: 'me',
  member: { memberId: 'me', fullName: 'Ana Pop' },
  status: 'pending',
  note: 'Vreau să ajut',
  created_at: '2026-09-24T12:00:00Z',
  decided_at: null,
  decided_by: null,
  decision_note: null,
};
function ready(data: unknown) {
  return { data, isPending: false, isError: false };
}
beforeEach(() => {
  api.level = 1;
  api.groups.mockReturnValue(
    ready([
      group(1, 'Educațional', { accepts_applications: false }),
      group(2, 'Echipa Evenimente', { parent_id: 1, path: [1, 2] }),
      group(3, 'Doar AG', { application_level: 3 }),
      group(4, 'Arhivat', { status: 'archived' }),
      group(5, 'Automat', { automatic_membership: true }),
      group(6, 'Grup privat', { is_private: true }),
    ]),
  );
  api.mine.mockReturnValue(ready([]));
  api.applications.mockReturnValue(ready([]));
  api.roster.mockReturnValue(
    ready([{ memberId: 'manager', fullName: 'Ioana', groupRole: 'manager' }]),
  );
  api.events.mockReturnValue(ready([]));
  api.mutate.mockReset().mockResolvedValue({});
});
function list() {
  return render(
    <MemoryRouter>
      <GroupsScreen />
    </MemoryRouter>,
  );
}
function detail(id = 2) {
  return render(
    <MemoryRouter initialEntries={[`/grupuri/${id}`]}>
      <Routes>
        <Route path="/grupuri/:groupId" element={<MemberGroupScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('lists only eligible active Groups and searches by name, with their first ancestor', async () => {
  list();
  expect(
    screen.getByRole('link', { name: 'Echipa Evenimente' }),
  ).toHaveAttribute('href', '/grupuri/2');
  expect(screen.getByText(/Echipă · Educațional/)).toBeInTheDocument();
  expect(screen.queryByText('Doar AG')).not.toBeInTheDocument();
  expect(screen.queryByText('Arhivat')).not.toBeInTheDocument();
  expect(screen.queryByText('Automat')).not.toBeInTheDocument();
  // Ruling R25: a Private Group a Member can read is still never offered.
  expect(screen.queryByText('Grup privat')).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), 'inexistent');
  expect(screen.getByRole('status')).toHaveTextContent('Nu sunt grupuri');
});
it('names the topmost ancestor the Member can read when the root is hidden', () => {
  api.groups.mockReturnValue(
    ready([
      group(2, 'Echipa Evenimente', { parent_id: 1, path: [1, 2] }),
      group(7, 'Subechipa', { parent_id: 2, path: [1, 2, 7] }),
    ]),
  );
  list();
  expect(screen.getByText(/Echipă · Echipa Evenimente/)).toBeInTheDocument();
});
it('applies in a dialog and renders the pending server state with withdrawal', async () => {
  const view = list();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Aplică' }));
  await user.type(screen.getByLabelText('Mesaj (opțional)'), 'Bună');
  await user.click(screen.getByRole('button', { name: 'Confirmă' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'apply',
    groupId: 2,
    note: 'Bună',
  });
  api.applications.mockReturnValue(ready([application]));
  view.rerender(
    <MemoryRouter>
      <GroupsScreen />
    </MemoryRouter>,
  );
  expect(screen.getByText('Cerere în așteptare')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retrage aplicația' }));
  await user.click(screen.getByRole('button', { name: 'Confirmă' }));
  expect(api.mutate).toHaveBeenLastCalledWith({
    kind: 'withdraw',
    applicationId: 7,
  });
  api.applications.mockReturnValue(ready([]));
  view.rerender(
    <MemoryRouter>
      <GroupsScreen />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Aplică' })).toBeInTheDocument();
});
it('checks the optional note against its 1000-character limit before applying', async () => {
  list();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Aplică' }));
  const note = screen.getByLabelText('Mesaj (opțional)');
  await user.click(note);
  await user.paste('n'.repeat(1001));
  await user.click(screen.getByRole('button', { name: 'Confirmă' }));
  expect(
    await screen.findByText('Nota are cel mult 1000 de caractere.'),
  ).toBeInTheDocument();
  expect(note).toHaveAttribute('aria-invalid', 'true');
  expect(api.mutate).not.toHaveBeenCalled();
});
it.each([true, false])(
  'manager decides an Application: accept=%s',
  async (accept) => {
    api.applications.mockReturnValue(ready([application]));
    const view = render(<GroupApplicationsTab groupId={2} canDecide />);
    const user = userEvent.setup();
    expect(screen.getByText('Ana Pop')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: accept ? 'Acceptă' : 'Respinge' }),
    );
    await user.type(screen.getByLabelText('Mesaj (opțional)'), 'Decizie');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Confirmă',
      }),
    );
    expect(api.mutate).toHaveBeenCalledWith({
      kind: 'decide',
      applicationId: 7,
      accept,
      note: 'Decizie',
    });
    api.applications.mockReturnValue(ready([]));
    view.rerender(<GroupApplicationsTab groupId={2} canDecide />);
    expect(
      screen.getByText('Nu sunt cereri în așteptare.'),
    ).toBeInTheDocument();
  },
);
it('ordinary Member sees Group details, role titles and upcoming empty state', () => {
  detail();
  expect(
    screen.getByRole('heading', { name: 'Echipa Evenimente' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Ioana')).toBeInTheDocument();
  expect(screen.getByText('Nu sunt evenimente viitoare.')).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Administrare' }),
  ).not.toBeInTheDocument();
});
it('a Private Group page carries the Privat badge and no Aplică', () => {
  // Readable (the database decides that), accepting on paper, but private.
  detail(6);
  expect(screen.getByText('Privat')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Aplică' }),
  ).not.toBeInTheDocument();
});
it('applicant sees pending status and can withdraw on the Group page', () => {
  api.applications.mockReturnValue(ready([application]));
  detail();
  expect(screen.getByText('Cerere în așteptare')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Retrage aplicația' }),
  ).toBeInTheDocument();
});
it('Manager sees the Administrare link and their own effective Role', () => {
  api.mine.mockReturnValue(
    ready([{ id: 2, group_role: 'manager', explicit: true, automatic: false }]),
  );
  detail();
  expect(screen.getByRole('link', { name: 'Administrare' })).toHaveAttribute(
    'href',
    '/administrare/grupuri/2',
  );
  expect(
    screen.getByText('Coordonator', { selector: 'strong' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Aplică' }),
  ).not.toBeInTheDocument();
});
it('has no automated accessibility violations', async () => {
  const { container } = list();
  expect((await axe.run(container)).violations).toEqual([]);
});

/* ---- #698 (ruling R18): a form link replaces the in-app Application ---- */
const FORM_URL = 'https://forms.example.org/evenimente';
function withFormLink() {
  api.groups.mockReturnValue(
    ready([
      group(1, 'Educațional', { accepts_applications: false }),
      group(2, 'Echipa Evenimente', {
        parent_id: 1,
        path: [1, 2],
        application_form_label: 'Completează formularul',
        application_form_url: FORM_URL,
      }),
    ]),
  );
}
async function expectFormLinkInsteadOfApplying() {
  const link = screen.getByRole('link', { name: /Completează formularul/ });
  expect(link).toHaveAttribute('href', FORM_URL);
  expect(link).toHaveAttribute('target', '_blank');
  expect(
    screen.getByText(
      'Înscrierea se face prin formular; responsabilii grupului te adaugă după ce răspunzi.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Aplică' }),
  ).not.toBeInTheDocument();
  // Opening the form files nothing: no dialog, no apply_to_group, no badge.
  const stopNavigation = (event: Event) => event.preventDefault();
  document.addEventListener('click', stopNavigation);
  await userEvent.click(link);
  document.removeEventListener('click', stopNavigation);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.mutate).not.toHaveBeenCalled();
  expect(screen.queryByText('Cerere în așteptare')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retrage aplicația' }),
  ).not.toBeInTheDocument();
}
it('on /grupuri, a Group with a form link offers the form, not an Application', async () => {
  withFormLink();
  list();
  await expectFormLinkInsteadOfApplying();
});
it('on the Group page, a Group with a form link offers the form, not an Application', async () => {
  withFormLink();
  detail();
  await expectFormLinkInsteadOfApplying();
});
it('without a form link, the Group page keeps the in-app Application dialog', async () => {
  const user = userEvent.setup();
  detail();
  await user.click(screen.getByRole('button', { name: 'Aplică' }));
  await user.click(screen.getByRole('button', { name: 'Confirmă' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'apply',
    groupId: 2,
    note: '',
  });
  expect(screen.queryByRole('link', { name: /filă nouă/ })).toBeNull();
});
it('with a form link, a Member below the Application Level is offered neither', () => {
  api.level = 0;
  withFormLink();
  detail();
  expect(
    screen.queryByRole('link', { name: /Completează formularul/ }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Aplică' })).toBeNull();
});
it('never lists a Private Group to apply to, and badges it on its page with no Aplică (R25)', () => {
  api.groups.mockReturnValue(
    ready([
      group(2, 'Echipa Evenimente'),
      // Readable by this Member (the database decided), still not offered.
      group(6, 'Comitet Secret', {
        is_private: true,
        application_form_label: 'Formular',
        application_form_url: FORM_URL,
      }),
    ]),
  );
  const view = list();
  expect(screen.getByText('Echipa Evenimente')).toBeInTheDocument();
  expect(screen.queryByText('Comitet Secret')).not.toBeInTheDocument();
  view.unmount();
  detail(6);
  expect(
    screen.getByRole('heading', { name: 'Comitet Secret' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Privat')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aplică' })).toBeNull();
  expect(screen.queryByRole('link', { name: /Formular/ })).toBeNull();
});
it('the form link passes the accessibility check', async () => {
  withFormLink();
  const { container } = list();
  expect((await axe.run(container)).violations).toEqual([]);
});
