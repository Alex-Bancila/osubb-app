import { describe, expect, it } from 'vitest';
import {
  executesTask,
  initialDraft,
  mutedGroupIds,
  preferenceTree,
  searchTree,
  selectedSummary,
  summaryText,
  tickState,
  toggleNode,
  unselectAll,
  unselectedPayload,
  type GroupPreferenceRow,
  type PreferenceGroup,
} from './preferred-groups';

// OSUBB (1, locked), Educațional (10) > Mentorat (11) > Ateliere (12),
// Resurse Umane (20) > Biroul (21, the board Group: locked), Adunarea
// Generală (30, locked), an archived Group (40) and a Private one nobody
// answered for (50).
const groups: PreferenceGroup[] = [
  {
    id: 1,
    name: 'Organizația',
    path: [1],
    status: 'active',
    is_organization: true,
  },
  { id: 10, name: 'Educațional', path: [10], status: 'active' },
  { id: 11, name: 'Mentorat', path: [10, 11], status: 'active' },
  { id: 12, name: 'Ateliere', path: [10, 11, 12], status: 'active' },
  { id: 20, name: 'Resurse Umane', path: [20], status: 'active' },
  { id: 21, name: 'Biroul de Conducere', path: [20, 21], status: 'active' },
  { id: 30, name: 'Adunarea Generală', path: [30], status: 'active' },
  { id: 40, name: 'Vechi', path: [40], status: 'archived' },
  { id: 50, name: 'Privat', path: [50], status: 'active' },
];
const rows: GroupPreferenceRow[] = [
  { group_id: 1, selected: true, locked: 'organization' },
  { group_id: 10, selected: true, locked: null },
  { group_id: 11, selected: false, locked: null },
  { group_id: 12, selected: true, locked: null },
  { group_id: 20, selected: true, locked: null },
  { group_id: 21, selected: true, locked: 'board' },
  { group_id: 30, selected: true, locked: 'adunarea_generala' },
  { group_id: 40, selected: false, locked: null },
];
const tree = preferenceTree(groups, rows);
const node = (id: number) => {
  const found = tree.find((entry) => entry.group.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};

describe('preferenceTree', () => {
  it('draws the active Groups the server answered for, in tree order, with depth and locks', () => {
    expect(
      tree.map((entry) => [entry.group.id, entry.depth, entry.lock]),
    ).toEqual([
      [1, 0, 'organization'],
      [30, 0, 'adunarea_generala'],
      [10, 0, null],
      [11, 1, null],
      [12, 2, null],
      [20, 0, null],
      [21, 1, 'board'],
    ]);
  });

  it('gives each Group the unlocked Groups at and below it', () => {
    expect(node(10).subtree).toEqual([10, 11, 12]);
    expect(node(20).subtree).toEqual([20]);
    expect(node(1).subtree).toEqual([]);
  });
});

describe('the boxes', () => {
  const draft = initialDraft(rows);

  it('starts from the unselected, unlocked Groups -- an archived one kept', () => {
    expect([...draft].sort()).toEqual([11, 40]);
  });

  it('shows a parent with one subgroup unticked as mixed, the subgroup alone as empty', () => {
    expect(tickState(node(10), draft)).toBe('mixed');
    expect(tickState(node(11), draft)).toBe('mixed');
    expect(tickState(node(12), draft)).toBe('checked');
    expect(tickState(node(1), draft)).toBe('checked');
  });

  it('unticks a ticked Group with every subgroup below it', () => {
    const next = toggleNode(node(12), new Set());
    expect([...next]).toEqual([12]);
    const parent = toggleNode(node(10), new Set());
    expect([...parent].sort()).toEqual([10, 11, 12]);
    expect(tickState(node(10), parent)).toBe('unchecked');
  });

  it('ticks a mixed or empty Group and its subtree again', () => {
    expect([...toggleNode(node(10), new Set([11]))]).toEqual([]);
    expect([...toggleNode(node(10), new Set([10, 11, 12]))]).toEqual([]);
  });

  it('never moves a locked Group, and a locked subgroup never joins its parent', () => {
    expect(toggleNode(node(21), new Set())).toEqual(new Set());
    expect([...toggleNode(node(20), new Set())]).toEqual([20]);
  });

  it('Deselectează tot takes every unlocked Group and leaves the locks', () => {
    expect([...unselectAll(tree)].sort((a, b) => a - b)).toEqual([
      10, 11, 12, 20,
    ]);
  });

  it('sends the draft ascending', () => {
    expect(unselectedPayload(new Set([20, 11, 12]))).toEqual([11, 12, 20]);
  });
});

describe('the summary', () => {
  it('counts the drawn Groups that stay selected', () => {
    expect(selectedSummary(tree, new Set([11, 40]))).toEqual({
      selected: 6,
      total: 7,
    });
    expect(summaryText({ selected: 6, total: 7 })).toBe('6 din 7 grupuri');
    expect(summaryText({ selected: 7, total: 7 })).toBe('Toate cele 7 grupuri');
  });
});

describe('searchTree', () => {
  it('keeps each match with the Groups above it, ignoring diacritics', () => {
    expect(searchTree(tree, 'atelier').map((entry) => entry.group.id)).toEqual([
      10, 11, 12,
    ]);
    expect(searchTree(tree, 'generala').map((entry) => entry.group.id)).toEqual(
      [30],
    );
    expect(searchTree(tree, '  ')).toHaveLength(tree.length);
  });
});

describe('the default views', () => {
  it('mutes exactly the unselected Groups the server answered', () => {
    expect([...mutedGroupIds(rows)].sort()).toEqual([11, 40]);
    expect(mutedGroupIds(undefined).size).toBe(0);
  });

  it('knows a Task the member executes now', () => {
    const task = {
      group_id: 11,
      assignments: [{ member_id: 'me', ended_at: null }],
    };
    expect(executesTask(task, 'me')).toBe(true);
    expect(executesTask(task, 'other')).toBe(false);
    expect(
      executesTask(
        {
          group_id: 11,
          assignments: [{ member_id: 'me', ended_at: '2026-01-01' }],
        },
        'me',
      ),
    ).toBe(false);
    expect(
      executesTask({ group_id: 11, visibleExecutor: { memberId: 'me' } }, 'me'),
    ).toBe(true);
  });
});

describe('a locked Group with a free subgroup', () => {
  const locked = preferenceTree(
    [
      { id: 30, name: 'Adunarea Generală', path: [30], status: 'active' },
      { id: 31, name: 'Comisia', path: [30, 31], status: 'active' },
    ],
    [
      { group_id: 30, selected: true, locked: 'adunarea_generala' },
      { group_id: 31, selected: true, locked: null },
    ],
  );

  it('does not move, and takes no subgroup with it', () => {
    const [ag, child] = locked;
    if (!ag || !child) throw new Error('tree');
    expect(ag.subtree).toEqual([31]);
    expect(toggleNode(ag, new Set()).size).toBe(0);
    expect([...toggleNode(child, new Set())]).toEqual([31]);
  });
});
