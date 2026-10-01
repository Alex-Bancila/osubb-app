import { expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  applicationCount,
  applicationGroups,
  applicationsTabShown,
} from './applications-tab';

const group = (
  id: number,
  accepts: boolean,
  status: 'active' | 'archived' = 'active',
) => ({ id, accepts_applications: accepts, status });

it('shows Cereri de aderare only when a managed Group takes Applications (B55)', () => {
  const base = {
    createTopLevelGroups: false,
    groups: [group(1, true), group(2, false)],
    pending: 0,
  };
  // Managing the accepting Group.
  expect(
    applicationsTabShown({
      ...base,
      myGroups: [{ id: 1, group_role: 'responsible' }],
    }),
  ).toBe(true);
  // Managing only a Group that does not accept.
  expect(
    applicationsTabShown({
      ...base,
      myGroups: [{ id: 2, group_role: 'manager' }],
    }),
  ).toBe(false);
  // Only a plain Member of the accepting Group: nothing to decide there.
  expect(
    applicationsTabShown({
      ...base,
      myGroups: [{ id: 1, group_role: 'member' }],
    }),
  ).toBe(false);
});

it('shows it while an Application is pending, and to BC for any accepting Group', () => {
  expect(
    applicationsTabShown({
      createTopLevelGroups: false,
      groups: [group(2, false)],
      myGroups: [{ id: 2, group_role: 'manager' }],
      pending: 1,
    }),
  ).toBe(true);
  expect(
    applicationsTabShown({
      createTopLevelGroups: true,
      groups: [group(3, true)],
      myGroups: [],
      pending: 0,
    }),
  ).toBe(true);
  // An archived Group takes nothing.
  expect(
    applicationsTabShown({
      createTopLevelGroups: true,
      groups: [group(3, true, 'archived')],
      myGroups: [],
      pending: 0,
    }),
  ).toBe(false);
});

const row = (
  id: number,
  name: string,
  path: number[],
  status = 'active',
  color: string | null = null,
) => ({
  id,
  name,
  color,
  path,
  parent_id: path.length > 1 ? (path[path.length - 2] ?? null) : null,
  manager_title: id === 1 ? 'Director' : null,
  responsible_title: null as string | null,
  status,
});
const led = (
  target: ReturnType<typeof row>,
  group_role: string,
  explicit = true,
) => ({ ...target, group_role, explicit, automatic: false });
const pendingOn = (group_id: number, name = `G${group_id}`) => ({
  group_id,
  group: { name },
});

it('lists every active Group led here or above, in tree order, with counts from the queue (#922)', () => {
  const dept = row(1, 'Diverse', [1]);
  const team = row(3, 'Echipa IT', [1, 3]);
  const other = row(2, 'Logistică', [2]);
  const archived = row(4, 'Gala', [4], 'archived');
  const plain = row(6, 'Membru doar', [6]);
  const list = applicationGroups({
    applications: [pendingOn(3), pendingOn(3), pendingOn(2)],
    myGroups: [
      led(other, 'responsible'),
      led(team, 'manager', false),
      led(dept, 'manager'),
      // The server refuses a non-BC decision on an archived Group.
      led(archived, 'manager'),
      // A plain member decides nothing.
      led(plain, 'member'),
    ],
    groups: [dept, team, other, archived, plain],
    rosterRows: [
      { group_id: 1, group_role: 'manager' },
      { group_id: 2, group_role: 'responsible' },
    ],
  });
  expect(list).toEqual([
    {
      id: 1,
      name: 'Diverse',
      parentName: null,
      color: null,
      roleLabel: 'Director',
      inherited: false,
      pending: 0,
    },
    {
      id: 3,
      name: 'Echipa IT',
      parentName: 'Diverse',
      color: null,
      roleLabel: 'Coordonator',
      inherited: true,
      pending: 2,
    },
    {
      id: 2,
      name: 'Logistică',
      parentName: null,
      color: null,
      roleLabel: 'Responsabil',
      inherited: false,
      pending: 1,
    },
  ]);
});

it('adds every Group with a readable pending Application, led or not (BC and Moderator)', () => {
  const archived = row(4, 'Gala', [4], 'archived', '#F2A700');
  const list = applicationGroups({
    applications: [pendingOn(4, 'Gala'), pendingOn(9, 'Necunoscut')],
    myGroups: [led(archived, 'manager')],
    groups: [archived],
  });
  expect(
    list.map((entry) => [entry.id, entry.pending, entry.roleLabel]),
  ).toEqual([
    // Pending on an archived Group the viewer leads: still decidable by BC.
    [4, 1, 'Coordonator'],
    // A Group whose row the viewer cannot read keeps the queue's name.
    [9, 1, null],
  ]);
  expect(list[1]?.name).toBe('Necunoscut');
});

it("labels a Responsible's Group with the Group's name for the position (#962)", () => {
  const dept = {
    ...row(1, 'Educațional', [1]),
    responsible_title: 'Coordonator',
  };
  const team = row(2, 'Logistică', [2]);
  const list = applicationGroups({
    applications: [],
    myGroups: [led(dept, 'responsible'), led(team, 'responsible')],
    groups: [dept, team],
    rosterRows: [
      { group_id: 1, group_role: 'responsible' },
      { group_id: 2, group_role: 'responsible' },
    ],
  });
  expect(list.map((entry) => [entry.name, entry.roleLabel])).toEqual([
    ['Educațional', 'Coordonator'],
    // Without the setting: as before.
    ['Logistică', 'Responsabil'],
  ]);
});

it("labels a led Group by the viewer's own function name, else the Group's name for the position (#967)", () => {
  // Group 1's manager_title is "Director" (see row()).
  const dept = row(1, 'Educațional', [1]);
  const team = row(2, 'Logistică', [2]);
  const child = { ...row(3, 'Echipa IT', [1, 3]), manager_title: 'Șef' };
  const list = applicationGroups({
    applications: [],
    myGroups: [
      led(dept, 'manager'),
      led(team, 'responsible'),
      // Held from Educațional, above: no own row here, so no own title.
      led(child, 'manager', false),
    ],
    groups: [dept, team, child],
    rosterRows: [
      {
        group_id: 1,
        group_role: 'manager',
        position_title: 'Director Educațional',
      },
      {
        group_id: 2,
        group_role: 'responsible',
        position_title: 'Responsabil Logistică',
      },
    ],
  });
  expect(list.map((entry) => [entry.name, entry.roleLabel])).toEqual([
    ['Educațional', 'Director Educațional'],
    ['Echipa IT', 'Șef'],
    ['Logistică', 'Responsabil Logistică'],
  ]);
});

it.each([
  [0, '0 cereri'],
  [1, '1 cerere'],
  [2, '2 cereri'],
  [19, '19 cereri'],
  [20, '20 de cereri'],
  [101, '101 cereri'],
  [120, '120 de cereri'],
])('counts %i as "%s"', (count, text) => {
  expect(applicationCount(count)).toBe(text);
});
