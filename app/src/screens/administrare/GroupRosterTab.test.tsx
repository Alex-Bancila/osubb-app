import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type {
  AdminGroup,
  GroupAuthority,
  RosterEntry,
} from '../../queries/groups-admin';
import { GroupRosterTab } from './GroupRosterTab';

// #929 (ruling R32): the Roster lists every member of the Group -- its roster
// rows, its automatic members marked "Automat", and the membri de drept (BC
// and the Moderator) in their own list at the end -- and offers a removal only
// for a roster row.

const adunarea: AdminGroup = {
  id: 62,
  name: 'Adunarea Generală',
  short: null,
  color: null,
  category: 'team',
  path: [62],
  parent_id: null,
  min_level: 3,
  status: 'active',
  is_organization: false,
  manager_title: null,
  responsible_title: null,
  automatic_membership: true,
  accepts_applications: false,
  application_level: null,
  competes_in_cup: false,
  counts_toward_parent_cup: true,
  shared_work_visibility: false,
  is_private: false,
  application_form_label: null,
  application_form_url: null,
  memberCount: 5,
};

const everything: GroupAuthority = {
  manageWork: true,
  manageGroup: true,
  editStructure: true,
  appointManager: true,
  archive: true,
  editMinLevel: true,
};

function entry(
  memberId: string,
  name: string,
  source: RosterEntry['source'],
  extra: Partial<RosterEntry> = {},
): RosterEntry {
  return {
    memberId,
    name,
    avatarColor: null,
    groupRole: 'member',
    positionTitle: null,
    source,
    status: 'activ',
    roleId: 'vot',
    roleLabel: 'Voluntar cu Drept de Vot',
    level: 3,
    ...extra,
  };
}

const roster: RosterEntry[] = [
  entry('a', 'Alex Băncilă', 'roster', {
    groupRole: 'responsible',
    positionTitle: 'Responsabil Adunarea Generală',
    roleId: 'bce',
    roleLabel: 'BCE',
    level: 5,
  }),
  entry('m', 'Maria Dobre', 'automatic'),
  entry('r', 'Raluca Ionescu', 'automatic'),
  entry('c', 'Cristina Șerban', 'board', {
    roleId: 'bc',
    roleLabel: 'BC',
    level: 6,
  }),
  entry('o', 'Moderator OSUBB', 'board', {
    roleId: 'moderator',
    roleLabel: 'Moderator',
    level: 9,
  }),
];

function renderRoster(group: AdminGroup, rows: RosterEntry[]) {
  return render(
    <MemoryRouter>
      <GroupRosterTab
        group={group}
        roster={rows}
        members={[]}
        authority={everything}
        busy={false}
        error={null}
        onRun={vi.fn()}
      />
    </MemoryRouter>,
  );
}

it('marks the automatic members "Automat" and offers them no removal', () => {
  renderRoster(adunarea, roster);
  const table = screen.getByRole('table');
  const maria = within(table).getByRole('row', { name: /Maria Dobre/ });
  expect(within(maria).getByText('Automat')).toBeInTheDocument();
  expect(within(maria).queryByRole('button')).toBeNull();
  // A roster row keeps its Group Role.
  const alex = within(table).getByRole('row', { name: /Alex Băncilă/ });
  expect(
    within(alex).getByText('Responsabil Adunarea Generală'),
  ).toBeInTheDocument();
});

it('closes the roster with the membri de drept, named by Role, with no controls', () => {
  renderRoster(adunarea, roster);
  const table = screen.getByRole('table');
  expect(within(table).queryByText('Cristina Șerban')).toBeNull();
  const board = screen.getByRole('region', {
    name: 'Biroul de Conducere · membri de drept',
  });
  const rows = within(board).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'CȘCristina ȘerbanBC',
    'MOModerator OSUBBModerator',
  ]);
  expect(within(board).queryByRole('button')).toBeNull();
  expect(
    within(board).getByRole('link', { name: 'Cristina Șerban' }),
  ).toHaveAttribute('href', '/administrare/membri/c');
});

it('names board members by their Board Title in Rol OSUBB and among the membri de drept (#963)', () => {
  renderRoster(adunarea, [
    entry('a', 'Alex Băncilă', 'roster', {
      groupRole: 'responsible',
      positionTitle: 'Responsabil Adunarea Generală',
      roleId: 'bce',
      roleLabel: 'Coordonator IT',
      level: 5,
    }),
    entry('m', 'Maria Dobre', 'automatic'),
    entry('c', 'Cristina Șerban', 'board', {
      roleId: 'bc',
      roleLabel: 'Președinte',
      level: 6,
    }),
  ]);
  const alex = within(screen.getByRole('table')).getByRole('row', {
    name: /Alex Băncilă/,
  });
  // The Group Role and the Board Title side by side, each in its column.
  expect(
    within(alex).getByText('Responsabil Adunarea Generală'),
  ).toBeInTheDocument();
  expect(within(alex).getByText('Coordonator IT')).toBeInTheDocument();
  const board = screen.getByRole('region', {
    name: 'Biroul de Conducere · membri de drept',
  });
  expect(
    within(board)
      .getAllByRole('listitem')
      .map((row) => row.textContent),
  ).toEqual(['CȘCristina ȘerbanPreședinte']);
});

it('offers a roster member of a plain Group a removal, and never a membru de drept', () => {
  const team = {
    ...adunarea,
    id: 9,
    name: 'Echipa IT',
    automatic_membership: false,
    min_level: 0,
  };
  renderRoster(team, [
    entry('v', 'Vlad Constantin', 'roster', {
      roleId: 'activ',
      roleLabel: 'Voluntar Activ',
      level: 2,
    }),
    entry('c', 'Cristina Șerban', 'board', { roleLabel: 'BC', level: 6 }),
  ]);
  expect(
    screen.getByRole('button', { name: 'Scoate pe Vlad Constantin din grup' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Cristina Șerban/ })).toBeNull();
});

it('shows no membri de drept list when the Group has none to show', () => {
  renderRoster(adunarea, roster.slice(0, 3));
  expect(
    screen.queryByRole('region', {
      name: 'Biroul de Conducere · membri de drept',
    }),
  ).toBeNull();
});
