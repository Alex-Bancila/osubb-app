import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DirectExecutorData } from '../../queries/direct-executors';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const hook = vi.hoisted(() => vi.fn());
vi.mock('../../queries/direct-executors', async (original) => ({
  ...(await original<object>()),
  useDirectExecutors: hook,
}));
import { DirectExecutorSelector } from './DirectExecutorSelector';

const data: DirectExecutorData = {
  members: [
    { id: 'ana', name: 'Ana Șerban', level: 1 },
    { id: 'mihai', name: 'Mihai Pop', level: 3 },
  ],
  groups: [
    {
      id: 1,
      name: 'Educațional',
      path: [1],
      min_level: 0,
      automatic_membership: false,
      status: 'active',
    },
    {
      id: 2,
      name: 'Echipa',
      path: [1, 2],
      min_level: 0,
      automatic_membership: false,
      status: 'active',
    },
    {
      id: 3,
      name: 'Adunarea Generală',
      path: [3],
      min_level: 3,
      automatic_membership: true,
      status: 'active',
    },
  ],
  memberships: [{ group_id: 2, member_id: 'ana' }],
  campaigns: [{ id: 10, name: 'Campania de toamnă' }],
  assignments: [{ id: 1, member_id: 'mihai', task: { campaign_id: 10 } }],
};
beforeEach(() =>
  hook.mockReturnValue({
    data,
    isSuccess: true,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
);

it('returns one member ID and searches Romanian names without diacritics', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <DirectExecutorSelector originGroupId={1} value={null} onChange={change} />,
  );
  await user.type(screen.getByRole('searchbox'), 'serban');
  expect(
    screen.queryByRole('option', { name: 'Mihai Pop' }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Executor'), 'ana');
  expect(change).toHaveBeenLastCalledWith('ana');
});

it('includes descendants, supports Campaign history, and restores all eligible members when cleared', async () => {
  const user = userEvent.setup();
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText('Grup (include subgrupurile)'),
    '1',
  );
  expect(
    screen.getByRole('option', { name: 'Ana Șerban' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Mihai Pop' }),
  ).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText('Grup (include subgrupurile)'),
    '',
  );
  await user.selectOptions(screen.getByLabelText('Campanie'), '10');
  expect(
    screen.queryByRole('option', { name: 'Ana Șerban' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Mihai Pop' })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Campanie'), '');
  expect(
    screen.getByRole('option', { name: 'Ana Șerban' }),
  ).toBeInTheDocument();
});

it('preserves filtered-out selections but clears them when Origin minimum increases', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const { rerender } = render(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  await user.type(screen.getByRole('searchbox'), 'mihai');
  expect(screen.getByLabelText('Executor')).toHaveValue('ana');
  expect(change).not.toHaveBeenCalled();
  rerender(
    <DirectExecutorSelector originGroupId={3} value="ana" onChange={change} />,
  );
  expect(change).toHaveBeenCalledWith(null);
  expect(screen.queryByRole('option', { name: /Ana/ })).not.toBeInTheDocument();
});

it('clears deactivated selections after refreshed data, but not during loading or errors', () => {
  const change = vi.fn();
  hook.mockReturnValue({ data: undefined, isSuccess: false, isPending: true });
  const { rerender } = render(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Se încarcă');
  expect(change).not.toHaveBeenCalled();
  hook.mockReturnValue({
    data: { ...data, members: [data.members[1]] },
    isSuccess: true,
  });
  rerender(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  expect(change).toHaveBeenCalledWith(null);
});

it('offers retry and announces no matches', async () => {
  const user = userEvent.setup();
  const refetch = vi.fn();
  hook.mockReturnValue({ isError: true, refetch });
  const { rerender } = render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Reîncarcă lista' }));
  expect(refetch).toHaveBeenCalled();
  hook.mockReturnValue({ data, isSuccess: true });
  rerender(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.type(screen.getByRole('searchbox'), 'Nobody');
  expect(screen.getByRole('status')).toHaveTextContent('Niciun membru');
});

it('has no automated accessibility violations', async () => {
  const { container } = render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  expect((await axe.run(container)).violations).toEqual([]);
});

it('derives Automatic Membership by level and permits a readable archived Origin', async () => {
  hook.mockReturnValue({
    data: {
      ...data,
      groups: data.groups.map((group) => ({ ...group, status: 'archived' })),
    },
    isSuccess: true,
  });
  const user = userEvent.setup();
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('option', { name: 'Ana Șerban' }),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText('Grup (include subgrupurile)'),
    '3',
  );
  expect(
    screen.queryByRole('option', { name: 'Ana Șerban' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Mihai Pop' })).toBeInTheDocument();
});
