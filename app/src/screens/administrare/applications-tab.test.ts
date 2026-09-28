import { expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { applicationsTabShown } from './applications-tab';

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
