import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '../../queries/reference';

const hooks = vi.hoisted(() => ({
  useDeptCup: vi.fn(),
  useGroups: vi.fn(),
}));

vi.mock('../../queries/points', () => ({ useDeptCup: hooks.useDeptCup }));
vi.mock('../../queries/reference', () => ({ useGroups: hooks.useGroups }));
vi.mock('@ionic/react', () => ({ IonIcon: () => null }));

import DeptCupCard from './DeptCupCard';

/**
 * The Group the Cup row resolves to. Its name, tag and colour are all different
 * from the values `dept_cup` carries, so every assertion below can only pass
 * through the Group.
 */
const eduGroup: Group = {
  id: 7,
  name: 'Educațional',
  short: 'EDU',
  color: '#284C93',
  category: 'department',
  path: [7],
  parent_id: null,
  min_level: 0,
  status: 'active',
  is_organization: false,
  // No bridge: the Cup row reaches its Group by `group_id` alone.
  legacy_dept_id: null,
};

function setCup(rows: unknown[]) {
  hooks.useDeptCup.mockReturnValue({
    data: rows,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  });
}

describe('DeptCupCard', () => {
  beforeEach(() => {
    hooks.useGroups.mockReturnValue({ data: new Map([[7, eduGroup]]) });
  });

  // `public.dept_cup` carries `group_id`, and the card reaches the Group by it
  // (#577). Mutation this catches: replace the lookup with `undefined` and the
  // row silently degrades to the view's own `name` and neutral ink — both of
  // which look like legitimate values, which is why this has to be pinned.
  it("takes each standing's name, tag and colour from its Group", () => {
    setCup([{ group_id: 7, name: 'nume din view', points: 12, members: 3 }]);

    render(<DeptCupCard />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Educațional')).toBeInTheDocument();
    expect(within(row).getByText('EDU')).toBeInTheDocument();
    expect(row).toHaveStyle({ '--dept': '#284C93' });
    expect(within(row).queryByText('nume din view')).not.toBeInTheDocument();
    expect(within(row).queryByText('edu')).not.toBeInTheDocument();
  });

  // The degradation path, stated rather than assumed: a competing Department
  // whose Group this member cannot read still gets a row, with the view's own
  // values and no colour — and #200's neutral tag, never the raw id that
  // would otherwise be the only thing left to show.
  it('falls back to a neutral tag when a group_id matches no readable Group', () => {
    hooks.useGroups.mockReturnValue({
      data: new Map<number, Group>(),
      isPending: false,
    });
    setCup([{ group_id: 7, name: 'nume din view', points: 12, members: 3 }]);

    render(<DeptCupCard />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('nume din view')).toBeInTheDocument();
    expect(row).toHaveStyle({ '--dept': 'var(--ink-400)' });
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('edu')).not.toBeInTheDocument();
  });

  // #200 — the flash this issue exists to close: `dept_cup` and `groups` are
  // two independent queries, and `dept_cup` can resolve first. While `groups`
  // is still in flight, the card must show a neutral placeholder instead of
  // rendering rows keyed off `row.dept_id` ('edu', 'pr', …).
  it('shows a neutral placeholder, never the raw id, while Groups are loading', () => {
    hooks.useGroups.mockReturnValue({ data: undefined, isPending: true });
    setCup([{ group_id: 7, name: 'nume din view', points: 12, members: 3 }]);

    render(<DeptCupCard />);

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('edu')).not.toBeInTheDocument();
    expect(screen.queryByText('nume din view')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // The same flash, from the other side: `dept_cup`'s own query can still be
  // pending while `groups` has already resolved. No row — and so no raw id —
  // may render until both are ready.
  it('shows a neutral placeholder, never the raw id, while the Cup itself is loading', () => {
    hooks.useGroups.mockReturnValue({
      data: new Map([[7, eduGroup]]),
      isPending: false,
    });
    hooks.useDeptCup.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      refetch: vi.fn(),
    });

    render(<DeptCupCard />);

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('edu')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
