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
  legacy_dept_id: 'edu',
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

  // `public.dept_cup` still keys its rows by `dept_id` on `main`, so the card
  // reaches the Group through `groups.legacy_dept_id`. Mutation this catches:
  // replace the lookup with `undefined` and the row silently degrades to the
  // view's own `name`, its raw `dept_id` and neutral ink — all of which look
  // like legitimate legacy values, which is exactly why this has to be pinned.
  it("takes each standing's name, tag and colour from its Group", () => {
    setCup([{ dept_id: 'edu', name: 'nume din view', points: 12, members: 3 }]);

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
  // values and no colour.
  it('falls back to the view row when no Group matches the bridge', () => {
    hooks.useGroups.mockReturnValue({ data: new Map<number, Group>() });
    setCup([{ dept_id: 'edu', name: 'nume din view', points: 12, members: 3 }]);

    render(<DeptCupCard />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('nume din view')).toBeInTheDocument();
    expect(row).toHaveStyle({ '--dept': 'var(--ink-400)' });
  });
});
