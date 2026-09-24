import { expect, it } from 'vitest';
import type { AdminGroup } from '../../queries/groups-admin';
import {
  buildTree,
  categoryLabel,
  expandableIds,
  groupPathNames,
  groupRoleLabel,
  groupStatusLabel,
  membersBelowLevel,
  minLevelChoices,
  visibleRows,
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
    0, 1, 2, 3, 5, 6, 9,
  ]);
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
