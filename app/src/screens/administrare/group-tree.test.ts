import { expect, it } from 'vitest';
import type { AdminGroup, AppointableMember } from '../../queries/groups-admin';
import {
  buildTree,
  categoryLabel,
  expandableIds,
  groupPathNames,
  groupRoleLabel,
  currentGroupTab,
  directManagerCandidates,
  createdGroupManager,
  managerTitleFor,
  positionCandidates,
  groupStatusLabel,
  groupTabs,
  leadsAny,
  ledTree,
  membersBelowLevel,
  minLevelChoices,
  rosterBackState,
  unfinishedTasksPath,
  varies,
  visibleRows,
  type LedSource,
} from './group-tree';

function group(
  id: number,
  name: string,
  path: number[],
  parentId: number | null,
  extra: Partial<AdminGroup> = {},
): AdminGroup {
  return {
    id,
    name,
    short: null,
    color: null,
    category: 'team',
    path,
    parent_id: parentId,
    min_level: 0,
    status: 'active',
    is_organization: false,
    manager_title: null,
    automatic_membership: false,
    accepts_applications: false,
    application_level: null,
    competes_in_cup: false,
    counts_toward_parent_cup: true,
    shared_work_visibility: false,
    is_private: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 0,
    ...extra,
  };
}

const tree = [
  group(2, 'Logistică', [1, 2], 1),
  group(1, 'Educațional', [1], null),
  group(3, 'Amfiteatru', [1, 3], 1),
  group(4, 'Balul Bobocilor', [4], null),
  group(5, 'Foto', [1, 3, 5], 3),
];

it('puts parents before their children and sorts siblings by name', () => {
  expect(buildTree(tree).map((row) => [row.group.name, row.depth])).toEqual([
    ['Balul Bobocilor', 0],
    ['Educațional', 0],
    ['Amfiteatru', 1],
    ['Foto', 2],
    ['Logistică', 1],
  ]);
  expect(expandableIds(buildTree(tree)).sort()).toEqual([1, 3]);
});

it('treats a Group whose parent the caller cannot read as a root of what they see', () => {
  // A Team Manager reads their Team and its Child Group, never the Department.
  const partial = [
    group(3, 'Amfiteatru', [1, 3], 1),
    group(5, 'Foto', [1, 3, 5], 3),
  ];
  expect(buildTree(partial).map((row) => [row.group.name, row.depth])).toEqual([
    ['Amfiteatru', 0],
    ['Foto', 1],
  ]);
});

it('gives each subgroup its parent and the rail it draws (#921)', () => {
  const rows = buildTree(tree).map((row) => ({
    name: row.group.name,
    parentName: row.parentName,
    last: row.last,
    continues: row.continues,
  }));
  expect(rows).toEqual([
    { name: 'Balul Bobocilor', parentName: null, last: false, continues: [] },
    { name: 'Educațional', parentName: null, last: true, continues: [] },
    // Logistică follows Amfiteatru, so Amfiteatru's rail runs on past Foto.
    {
      name: 'Amfiteatru',
      parentName: 'Educațional',
      last: false,
      continues: [],
    },
    { name: 'Foto', parentName: 'Amfiteatru', last: true, continues: [true] },
    { name: 'Logistică', parentName: 'Educațional', last: true, continues: [] },
  ]);
  // Once Amfiteatru is the last child, nothing runs past its subtree.
  const lastBranch = buildTree(tree.filter((g) => g.name !== 'Logistică'));
  expect(
    lastBranch.find((row) => row.group.name === 'Foto')?.continues,
  ).toEqual([false]);
});

function mine(
  id: number,
  name: string,
  path: number[],
  groupRole: string,
  extra: Partial<LedSource> = {},
): LedSource {
  return {
    id,
    name,
    path,
    group_role: groupRole,
    explicit: true,
    automatic: false,
    category: 'team',
    color: '',
    min_level: 0,
    status: 'active',
    is_organization: false,
    ...extra,
  };
}

it('lists exactly the led Groups, inherited ones marked, parents kept as context (#921)', () => {
  const rows = ledTree(
    tree,
    [
      // Coordonator of Amfiteatru on its own roster row …
      mine(3, 'Amfiteatru', [1, 3], 'manager'),
      // … and so of Foto below it, from above (ruling R14).
      mine(5, 'Foto', [1, 3, 5], 'manager', { explicit: false }),
      // A plain membership leads nothing (B47).
      mine(4, 'Balul Bobocilor', [4], 'member'),
    ],
    [
      { group_id: 3, group_role: 'manager' },
      { group_id: 4, group_role: 'member' },
    ],
  );
  expect(rows.map((row) => [row.group.name, row.depth, row.lead])).toEqual([
    ['Educațional', 0, null],
    ['Amfiteatru', 1, { groupRole: 'manager', inherited: false }],
    ['Foto', 2, { groupRole: 'manager', inherited: true }],
  ]);
});

it('keeps a led Group the Group rows have not caught up with (#921)', () => {
  const rows = ledTree(
    [],
    [mine(9, 'Echipa nouă', [9], 'responsible')],
    [{ group_id: 9, group_role: 'responsible' }],
  );
  expect(rows.map((row) => [row.group.name, row.lead?.groupRole])).toEqual([
    ['Echipa nouă', 'responsible'],
  ]);
});

it('says whether the viewer leads any Group (#921)', () => {
  expect(leadsAny([{ group_role: 'member' }])).toBe(false);
  expect(leadsAny([])).toBe(false);
  expect(
    leadsAny([{ group_role: 'member' }, { group_role: 'responsible' }]),
  ).toBe(true);
  expect(leadsAny([{ group_role: 'manager' }])).toBe(true);
});

it('hides every Group under a collapsed ancestor, not just its direct children', () => {
  const rows = buildTree(tree);
  expect(visibleRows(rows, new Set()).map((row) => row.group.name)).toEqual([
    'Balul Bobocilor',
    'Educațional',
  ]);
  expect(visibleRows(rows, new Set([1])).map((row) => row.group.name)).toEqual([
    'Balul Bobocilor',
    'Educațional',
    'Amfiteatru',
    'Logistică',
  ]);
  expect(
    visibleRows(rows, new Set([1, 3])).map((row) => row.group.name),
  ).toEqual([
    'Balul Bobocilor',
    'Educațional',
    'Amfiteatru',
    'Foto',
    'Logistică',
  ]);
});

it('bounds a Minimum Level by the parent below and the caller above', () => {
  // Mirrors group_min_level_below_parent and group_min_level_above_actor.
  expect(minLevelChoices([0, 1, 2, 3, 5, 6, 9], 1, 5)).toEqual([1, 2, 3, 5]);
  expect(minLevelChoices([0, 1, 2, 3, 5, 6, 9], 3, 1)).toEqual([]);
  expect(minLevelChoices([0, 1, 2, 3, 5, 6, 9], 0, 9)).toEqual([
    0, 1, 2, 3, 5, 6,
  ]);
});

it('never offers a Minimum Level off the ladder: no Responsabil 4, no Moderator 9 (R29b)', () => {
  expect(minLevelChoices([9, 4, 6, 0, 3, 1, 5, 2], 0, 9)).toEqual([
    0, 1, 2, 3, 5, 6,
  ]);
  expect(minLevelChoices([4, 9], 0, 9)).toEqual([]);
});

it('names exactly the members a raised Minimum Level would remove', () => {
  const roster = [
    { memberId: 'a', level: 1 },
    { memberId: 'b', level: 3 },
    { memberId: 'c', level: 0 },
  ];
  expect(membersBelowLevel(roster, 3).map((row) => row.memberId)).toEqual([
    'a',
    'c',
  ]);
  expect(membersBelowLevel(roster, 0)).toEqual([]);
});

it('labels categories, statuses and Group Roles the way the Group names them', () => {
  expect(categoryLabel('department')).toBe('Departament');
  expect(categoryLabel('organization')).toBe('Organizație');
  expect(groupStatusLabel('archived')).toBe('Arhivat');
  expect(groupRoleLabel('manager', 'BCE')).toBe('BCE');
  expect(groupRoleLabel('manager')).toBe('Coordonator');
  expect(groupRoleLabel('responsible', 'BCE', 'Responsabil Logistică')).toBe(
    'Responsabil Logistică',
  );
  expect(groupRoleLabel('member', 'BCE', null)).toBe('Membru');
});

it('builds the breadcrumb from the Groups the caller can actually read', () => {
  const byId = new Map(tree.map((row) => [row.id, row]));
  expect(groupPathNames(group(5, 'Foto', [1, 3, 5], 3), byId)).toEqual([
    { id: 1, name: 'Educațional' },
    { id: 3, name: 'Amfiteatru' },
    { id: 5, name: 'Foto' },
  ]);
  expect(groupPathNames(group(9, 'Necunoscut', [99, 9], 99), byId)).toEqual([]);
});

it('links the unfinished work of a root without a Subgrup, and of a child with one (D9)', () => {
  expect(unfinishedTasksPath({ id: 1, path: [1] })).toBe(
    '/tracker?lista=gestionat&grup=1',
  );
  expect(unfinishedTasksPath({ id: 5, path: [1, 2, 5] })).toBe(
    '/tracker?lista=gestionat&grup=1&subgrup=5',
  );
});

const none = {
  manageGroup: false,
  editStructure: false,
  appointManager: false,
};
const facts = {
  hasChildren: false,
  canCreateChild: false,
  acceptsApplications: false,
  pendingApplications: 0,
};
const ids = (tabs: readonly { id: string }[]) => tabs.map((tab) => tab.id);

it('shows each Group tab only to the authority that can use it (B49)', () => {
  expect(ids(groupTabs(none, facts))).toEqual(['roster', 'campanii']);
  expect(ids(groupTabs({ ...none, editStructure: true }, facts))).toEqual([
    'setari',
    'roster',
    'campanii',
  ]);
  expect(
    ids(
      groupTabs(
        { ...none, manageGroup: true },
        { ...facts, canCreateChild: true },
      ),
    ),
  ).toEqual(['setari', 'roster', 'roluri', 'copii', 'campanii']);
  // Appointing the Manager one level up opens Roluri on its own.
  expect(ids(groupTabs({ ...none, appointManager: true }, facts))).toEqual([
    'roster',
    'roluri',
    'campanii',
  ]);
  expect(ids(groupTabs(none, { ...facts, hasChildren: true }))).toContain(
    'copii',
  );
  expect(
    ids(groupTabs(none, { ...facts, acceptsApplications: true })),
  ).toContain('cereri');
  expect(ids(groupTabs(none, { ...facts, pendingApplications: 2 }))).toContain(
    'cereri',
  );
});

it('opens the requested tab when it is shown, else the first (D6)', () => {
  const tabs = groupTabs(none, facts);
  expect(currentGroupTab('campanii', tabs)).toBe('campanii');
  expect(currentGroupTab('setari', tabs)).toBe('roster');
  expect(currentGroupTab('nimic', tabs)).toBe('roster');
  expect(currentGroupTab(null, tabs)).toBe('roster');
});

it('calls a column worth showing only when its values differ (B48)', () => {
  expect(varies([1, 1, 1], (value) => value)).toBe(false);
  expect(varies([], (value) => value)).toBe(false);
  expect(varies([0, 1], (value) => value)).toBe(true);
});

it('sends the member page back to the Roster tab (D4)', () => {
  expect(rosterBackState(7)).toEqual({
    from: { to: '/administrare/grupuri/7?tab=roster', label: 'Înapoi la grup' },
  });
});

function appointable(
  memberId: string,
  roleId: string,
  level: number,
  status = 'activ',
): AppointableMember {
  return {
    memberId,
    name: `Membru ${memberId}`,
    avatarColor: null,
    status,
    roleId,
    roleLabel: roleId,
    level,
  };
}

it("titles a new Group's direct Manager after its category (#951, #957)", () => {
  expect(managerTitleFor('department')).toBe('Vicepreședinte');
  expect(managerTitleFor('project')).toBe('Coordonator Principal');
  expect(managerTitleFor('team')).toBe('Coordonator');
});

it('offers as direct Manager every eligible active Member but the Moderator (#951)', () => {
  const members = [
    appointable('voluntar', 'voluntar', 1),
    appointable('recrut', 'recrut', 0),
    appointable('bc', 'bc', 6),
    appointable('moderator', 'moderator', 9),
    appointable('plecat', 'vot', 3, 'inactiv'),
  ];
  expect(
    directManagerCandidates(members, 0).map((member) => member.memberId),
  ).toEqual(['voluntar', 'recrut', 'bc']);
  // At or above the new Group's Minimum Level, as create_group requires.
  expect(
    directManagerCandidates(members, 1).map((member) => member.memberId),
  ).toEqual(['voluntar', 'bc']);
});

it('offers BC as Coordonator but never as Responsabil, and the Moderator as neither (#957)', () => {
  const members = [
    appointable('voluntar', 'voluntar', 1),
    appointable('bce', 'bce', 5),
    appointable('bc', 'bc', 6),
    appointable('moderator', 'moderator', 9),
    appointable('plecat', 'bc', 6, 'inactiv'),
  ];
  const scope = { min_level: 0 };
  const offered = (list: readonly { memberId: string }[]) =>
    list.map((member) => member.memberId);

  expect(
    offered(positionCandidates(members, scope, new Set(), 'manager')),
  ).toEqual(['voluntar', 'bce', 'bc']);
  expect(
    offered(positionCandidates(members, scope, new Set(), 'responsible')),
  ).toEqual(['voluntar', 'bce']);
  // A holder is offered for neither position, whatever the rank.
  expect(
    offered(positionCandidates(members, scope, new Set(['bc']), 'manager')),
  ).toEqual(['voluntar', 'bce']);
  // The Group's Minimum Level binds both pickers alike.
  expect(
    offered(
      positionCandidates(members, { min_level: 6 }, new Set(), 'manager'),
    ),
  ).toEqual(['bc']);
});

it('names the direct Manager in the receipt only when one was chosen (#951)', () => {
  const members = [appointable('ana', 'bce', 5)];
  expect(
    createdGroupManager({ category: 'department', managerId: null }, members),
  ).toBeNull();
  expect(
    createdGroupManager({ category: 'project', managerId: 'ana' }, members),
  ).toEqual({ member: members[0], title: 'Coordonator Principal' });
});
