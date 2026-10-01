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
  rosterRows: vi.fn(),
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
vi.mock('../../queries/reference', () => ({ useMyGroups: api.rosterRows }));
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
    responsible_title: null,
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
  api.rosterRows.mockReturnValue({ ...ready([]), membershipRows: [] });
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
it.each(['2.0', '0x2', '2e0', '02'])(
  'shows Grup indisponibil for the malformed id %s and never queries Group 2',
  (raw) => {
    render(
      <MemoryRouter initialEntries={[`/grupuri/${raw}`]}>
        <Routes>
          <Route path="/grupuri/:groupId" element={<MemberGroupScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: 'Grup indisponibil' }),
    ).toBeVisible();
    expect(api.roster).not.toHaveBeenCalledWith(2);
    expect(api.events).not.toHaveBeenCalledWith(2);
  },
);
it('lists only eligible active Groups and searches by name, with their first ancestor', async () => {
  api.groups.mockReturnValue(
    ready([
      ...api.groups().data,
      group(7, 'Echipa Media', { parent_id: 1, path: [1, 7] }),
    ]),
  );
  list();
  expect(
    screen.getByRole('link', { name: 'Echipa Evenimente' }),
  ).toHaveAttribute('href', '/grupuri/2');
  expect(screen.getAllByText(/Echipă · Educațional/)).toHaveLength(2);
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

/* ---- #852: Grupurile tale, an honest empty state, Event links ---- */
function myGroup(
  id: number,
  name: string,
  extra: Partial<{
    group_role: string;
    explicit: boolean;
    automatic: boolean;
    is_organization: boolean;
    status: string;
  }> = {},
) {
  return {
    id,
    name,
    group_role: 'member',
    explicit: true,
    automatic: false,
    is_organization: false,
    status: 'active',
    category: 'team',
    color: '#284C93',
    min_level: 0,
    path: [id],
    short: '',
    ...extra,
  };
}
it("lists the member's own Groups first, as links, with a position's display name", () => {
  api.groups.mockReturnValue(
    ready([
      group(5, 'OSUBB', { is_organization: true, accepts_applications: false }),
      group(8, 'Educațional', { accepts_applications: false }),
      group(58, 'Echipa Recruți', { accepts_applications: false }),
      group(60, 'Festivalul Studențesc 2026', { category: 'project' }),
      group(62, 'Echipa Logistică'),
    ]),
  );
  api.mine.mockReturnValue(
    ready([
      myGroup(5, 'OSUBB', {
        explicit: false,
        automatic: true,
        is_organization: true,
      }),
      myGroup(8, 'Educațional'),
      myGroup(58, 'Echipa Recruți'),
      myGroup(60, 'Festivalul Studențesc 2026', { group_role: 'responsible' }),
      // Archived: no page to open.
      myGroup(61, 'Gala Voluntarilor 2025', { status: 'archived' }),
      // Authority inherited from an ancestor is not membership (R31).
      myGroup(70, 'Subechipa', {
        group_role: 'manager',
        explicit: false,
        automatic: false,
      }),
    ]),
  );
  api.rosterRows.mockReturnValue({
    ...ready([]),
    membershipRows: [
      {
        group_id: 60,
        group_role: 'responsible',
        position_title: 'Responsabil proiect',
      },
    ],
  });
  list();
  const own = screen.getByRole('region', { name: 'Grupurile tale' });
  const links = within(own).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Echipa Recruți',
    'Educațional',
    'Festivalul Studențesc 2026',
  ]);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/grupuri/58',
    '/grupuri/8',
    '/grupuri/60',
  ]);
  // Only a position is labelled; plain membership is the section itself.
  expect(within(own).getByText('Responsabil proiect')).toBeInTheDocument();
  expect(within(own).queryByText('Membru')).toBeNull();
  // A Group the member is in is not offered again under "Poți aplica la".
  const apply = screen.getByRole('region', { name: 'Poți aplica la' });
  expect(within(apply).queryByText('Festivalul Studențesc 2026')).toBeNull();
  expect(
    within(apply).getByRole('link', { name: 'Echipa Logistică' }),
  ).toBeInTheDocument();
  // One Group to apply to: nothing to search.
  expect(screen.queryByRole('searchbox')).toBeNull();
});
it('shows no position for one inherited from above, even on the roster (F-17)', () => {
  api.groups.mockReturnValue(
    ready([
      group(8, 'Educațional', { accepts_applications: false }),
      group(58, 'Echipa IT', {
        parent_id: 8,
        path: [8, 58],
        accepts_applications: false,
      }),
    ]),
  );
  api.mine.mockReturnValue(
    ready([
      myGroup(8, 'Educațional', { group_role: 'manager' }),
      // A plain member here, Coordonator from Educațional.
      myGroup(58, 'Echipa IT', { group_role: 'manager' }),
    ]),
  );
  api.rosterRows.mockReturnValue({
    ...ready([]),
    membershipRows: [
      { group_id: 8, group_role: 'manager', position_title: null },
      { group_id: 58, group_role: 'member', position_title: null },
    ],
  });
  list();
  const own = screen.getByRole('region', { name: 'Grupurile tale' });
  const rows = within(own).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'Echipa ITEchipă',
    'EducaționalEchipă · Coordonator',
  ]);
});
it("names the member's own Coordonator position by their function name, else the Group's (#967)", () => {
  api.groups.mockReturnValue(
    ready([
      group(8, 'Educațional', {
        accepts_applications: false,
        manager_title: 'Vicepreședinte',
      }),
      group(9, 'Cultural', {
        accepts_applications: false,
        manager_title: 'Vicepreședinte',
      }),
    ]),
  );
  api.mine.mockReturnValue(
    ready([
      myGroup(8, 'Educațional', { group_role: 'manager' }),
      myGroup(9, 'Cultural', { group_role: 'manager' }),
    ]),
  );
  api.rosterRows.mockReturnValue({
    ...ready([]),
    membershipRows: [
      {
        group_id: 8,
        group_role: 'manager',
        position_title: 'Vicepreședinte Educațional',
      },
      { group_id: 9, group_role: 'manager', position_title: null },
    ],
  });
  list();
  const own = screen.getByRole('region', { name: 'Grupurile tale' });
  const rows = within(own).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'CulturalEchipă · Vicepreședinte',
    'EducaționalEchipă · Vicepreședinte Educațional',
  ]);
});
it('marks an archived Group as Arhivat on its page (F-18)', () => {
  // The fixture Group is named "Arhivat": its name, then the badge.
  detail(4);
  expect(screen.getAllByText('Arhivat')).toHaveLength(2);
});
it('says no Group accepts Applications, with no search box and no "căutare" (B28, D-18)', () => {
  api.groups.mockReturnValue(
    ready([group(8, 'Educațional', { accepts_applications: false })]),
  );
  api.mine.mockReturnValue(ready([myGroup(8, 'Educațional')]));
  list();
  expect(
    screen.getByText('Niciun grup nu primește acum cereri de înscriere.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.queryByText(/pentru această căutare/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Educațional' })).toHaveAttribute(
    'href',
    '/grupuri/8',
  );
});
it('a Group page Event title opens the Calendar on that Event (D5)', () => {
  api.events.mockReturnValue(
    ready([
      {
        id: 41,
        title: 'Ședință de echipă',
        starts_at: '2026-10-05T15:00:00Z',
        location: 'Sala 2',
      },
    ]),
  );
  detail();
  expect(
    screen.getByRole('link', { name: 'Ședință de echipă' }),
  ).toHaveAttribute('href', '/calendar?event=41');
});
it('hides Coordonare when nobody holds a position (B29)', () => {
  api.roster.mockReturnValue(
    ready([{ memberId: 'x', fullName: 'Ana', groupRole: 'member' }]),
  );
  detail();
  expect(screen.queryByRole('heading', { name: 'Coordonare' })).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'Evenimente viitoare' }),
  ).toBeInTheDocument();
});
it('lists the positions of Coordonare as rows with the title as the value', () => {
  detail();
  const panel = screen.getByRole('region', { name: 'Coordonare' });
  const row = within(panel).getByRole('listitem');
  expect(row).toHaveAttribute('data-slot', 'list-row');
  expect(
    within(row).getByText('Coordonator').closest('[data-slot]'),
  ).toHaveAttribute('data-slot', 'list-row-value');
});
it("names an untitled Responsible in Coordonare, and the viewer's own position, after the Group's setting (#962)", () => {
  api.groups.mockReturnValue(
    ready([
      group(2, 'Echipa Evenimente', { responsible_title: 'Coordonator' }),
    ]),
  );
  api.mine.mockReturnValue(
    ready([
      { id: 2, group_role: 'responsible', explicit: true, automatic: false },
    ]),
  );
  api.roster.mockReturnValue(
    ready([
      {
        memberId: 'me',
        fullName: 'Ana',
        groupRole: 'responsible',
        positionTitle: null,
      },
      {
        memberId: 'r',
        fullName: 'Radu',
        groupRole: 'responsible',
        positionTitle: 'Responsabil Foto',
      },
    ]),
  );
  detail();
  const panel = screen.getByRole('region', { name: 'Coordonare' });
  const [untitled, titled] = within(panel).getAllByRole('listitem');
  expect(
    within(untitled as HTMLElement).getByText('Coordonator'),
  ).toBeVisible();
  // A Responsible's own title still comes first.
  expect(
    within(titled as HTMLElement).getByText('Responsabil Foto'),
  ).toBeVisible();
  expect(
    screen.getByText('Coordonator', { selector: 'strong' }),
  ).toBeInTheDocument();
});

it("names each Coordonator in Coordonare, and the viewer's own position, by their function name, else the Group's (#967)", () => {
  api.groups.mockReturnValue(
    ready([
      group(2, 'Echipa Evenimente', { manager_title: 'Vicepreședinte' }),
    ]),
  );
  api.mine.mockReturnValue(
    ready([{ id: 2, group_role: 'manager', explicit: true, automatic: false }]),
  );
  api.roster.mockReturnValue(
    ready([
      {
        memberId: 'me',
        fullName: 'Ana',
        groupRole: 'manager',
        positionTitle: 'Vicepreședinte Educațional',
      },
      {
        memberId: 'v',
        fullName: 'Vlad',
        groupRole: 'manager',
        positionTitle: null,
      },
    ]),
  );
  detail();
  const panel = screen.getByRole('region', { name: 'Coordonare' });
  const [titled, untitled] = within(panel).getAllByRole('listitem');
  expect(
    within(titled as HTMLElement).getByText('Vicepreședinte Educațional'),
  ).toBeVisible();
  expect(
    within(untitled as HTMLElement).getByText('Vicepreședinte'),
  ).toBeVisible();
  expect(
    screen.getByText('Vicepreședinte Educațional', { selector: 'strong' }),
  ).toBeInTheDocument();
});
it("names the viewer's own untitled Coordonator position by the Group's name for it (#967)", () => {
  api.groups.mockReturnValue(
    ready([
      group(2, 'Echipa Evenimente', { manager_title: ' Vicepreședinte ' }),
    ]),
  );
  api.mine.mockReturnValue(
    ready([{ id: 2, group_role: 'manager', explicit: true, automatic: false }]),
  );
  api.roster.mockReturnValue(
    ready([
      {
        memberId: 'me',
        fullName: 'Ana',
        groupRole: 'manager',
        positionTitle: null,
      },
    ]),
  );
  detail();
  expect(
    screen.getByText('Vicepreședinte', { selector: 'strong' }),
  ).toBeInTheDocument();
});
it('the back link falls back to Grupuri, and prefers state.from (A33)', () => {
  const view = detail();
  expect(
    screen.getByRole('link', { name: 'Înapoi la Grupuri' }),
  ).toHaveAttribute('href', '/grupuri');
  view.unmount();
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/grupuri/2',
          state: { from: { to: '/notificari', label: 'Înapoi la Notificări' } },
        },
      ]}
    >
      <Routes>
        <Route path="/grupuri/:groupId" element={<MemberGroupScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('link', { name: 'Înapoi la Notificări' }),
  ).toHaveAttribute('href', '/notificari');
});
it('an unavailable Group says why and leads back to Grupuri (D23)', () => {
  detail(4040);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(
    screen.getByRole('heading', { name: 'Grup indisponibil' }),
  ).toBeVisible();
  expect(
    screen.getByText('Grupul a fost arhivat sau nu mai ai acces la el.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Înapoi la Grupuri' }),
  ).toHaveAttribute('href', '/grupuri');
});
it('Administrare is an outline button in the header, not a text link (G1)', () => {
  api.mine.mockReturnValue(
    ready([{ id: 2, group_role: 'manager', explicit: true, automatic: false }]),
  );
  detail();
  const link = screen.getByRole('link', { name: 'Administrare' });
  expect(link.closest('[data-slot=page-actions]')).not.toBeNull();
  expect(link).toHaveClass('border-border', 'min-h-11');
  expect(link).not.toHaveClass('underline');
});
